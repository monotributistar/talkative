import { createHash } from "node:crypto";
import {
  Prisma,
  type Attempt,
  type PrismaClient,
  type Task
} from "@prisma/client";
import type { AdapterResult, TaskCommand } from "../adapters/types.js";
import {
  CaseManager,
  CaseManagerError,
  type TransitionCaseInput
} from "../cases/case-manager.js";
import {
  ConsentManager,
  ConsentManagerError,
  type MedicalAppointmentEffect
} from "../cases/consent-manager.js";
import { parseRfc3339DateTime } from "../cases/rfc3339.js";
import { TaskExecutorError } from "./errors.js";
import type {
  AppointmentAdapterRegistry,
  TaskExecutionDecision,
  TaskExecutionOutcome
} from "./types.js";

type TransactionClient = Prisma.TransactionClient;
type ExecutableCaseStatus = "executing" | "waiting_external";

interface PersistedTask extends Task {
  case: {
    id: string;
    tenantId: string;
    subjectId: string;
    counterpartyId: string | null;
    type: string;
    status: string;
  };
}

interface ClaimedAttempt {
  kind: "claimed";
  task: PersistedTask;
  attempt: Attempt;
  replayed: boolean;
}

interface TerminalReplay {
  kind: "terminal_replay";
  task: PersistedTask;
  attempt: Attempt;
}

interface ExhaustedClaim {
  kind: "exhausted";
  task: PersistedTask;
}

type Claim = ClaimedAttempt | TerminalReplay | ExhaustedClaim;

export interface TaskExecutorDependencies {
  clock: () => Date;
  attemptId: (tenantId: string, idempotencyKey: string) => string;
  artifactId: (tenantId: string, attemptId: string, reference: string) => string;
  consentManager: (transaction: TransactionClient) => Pick<
    ConsentManager,
    "authorizeMedicalAppointmentEffect"
  >;
  caseManager: (transaction: TransactionClient) => Pick<CaseManager, "transition">;
}

const defaultAttemptId = (tenantId: string, key: string) =>
  `attempt:${hash(`${tenantId}\0${key}`).slice(0, 40)}`;

const defaultArtifactId = (
  tenantId: string,
  attemptId: string,
  reference: string
) => `artifact:${hash(`${tenantId}\0${attemptId}\0${reference}`).slice(0, 40)}`;

/**
 * Persistence-backed execution boundary.
 *
 * The transaction claims authority and an Attempt; the external adapter always
 * runs after commit. Case state changes are delegated exclusively to CaseManager.
 */
export class TaskExecutor {
  private readonly dependencies: TaskExecutorDependencies;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly adapters: AppointmentAdapterRegistry,
    dependencies: Partial<TaskExecutorDependencies> = {}
  ) {
    this.dependencies = {
      clock: () => new Date(),
      attemptId: defaultAttemptId,
      artifactId: defaultArtifactId,
      consentManager: (transaction) =>
        new ConsentManager(transaction as unknown as PrismaClient),
      caseManager: (transaction) =>
        new CaseManager(transaction as unknown as PrismaClient),
      ...dependencies
    };
  }

  async execute(command: TaskCommand): Promise<TaskExecutionOutcome> {
    let claim: Claim;
    try {
      claim = await this.claim(command);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw translateConsentError(error);
      claim = await this.recoverConcurrentIdempotency(command);
    }

    if (claim.kind === "terminal_replay") {
      return this.reconstructTerminalOutcome(this.prisma, claim.task, claim.attempt);
    }
    if (claim.kind === "exhausted") {
      return {
        attempt: null,
        result: null,
        decision: "needs_human",
        handoffReason: "ATTEMPTS_EXHAUSTED",
        replayed: false
      };
    }

    const adapter = this.adapters[claim.task.assignedAdapter];
    if (!adapter) {
      throw new TaskExecutorError(
        "ADAPTER_NOT_REGISTERED",
        "Persisted task adapter is not registered"
      );
    }

    const result = await adapter.execute(command);
    assertAdapterResult(result);
    const normalized = verifySuccessfulEvidence(adapter, claim.task.type, result);
    return this.persistResult(claim, normalized);
  }

  private claim(command: TaskCommand): Promise<Claim> {
    return withSerializationRetry(() => this.prisma.$transaction(
      async (transaction) => {
        await lockTask(transaction, command.tenant_id, command.task_id);
        const task = await findTask(transaction, command.tenant_id, command.task_id);
        if (!task) throw notFound();

        const existing = await transaction.attempt.findFirst({
          where: {
            tenantId: command.tenant_id,
            idempotencyKey: command.idempotency_key
          }
        });
        if (existing) {
          validateReplay(existing, task, command);
          if (isTerminalAttempt(existing.status)) {
            return { kind: "terminal_replay", task, attempt: existing };
          }
          validateExecutableAggregate(task, command);
          return { kind: "claimed", task, attempt: existing, replayed: true };
        }

        validateExecutableAggregate(task, command);
        const adapter = this.adapters[task.assignedAdapter];
        if (!adapter) {
          throw new TaskExecutorError(
            "ADAPTER_NOT_REGISTERED",
            "Persisted task adapter is not registered"
          );
        }

        await lockConsent(
          transaction,
          command.tenant_id,
          command.case_id,
          command.consent_id
        );
        const inFlight = await transaction.attempt.findFirst({
          where: {
            tenantId: command.tenant_id,
            taskId: command.task_id,
            status: { in: ["started", "waiting_external"] }
          },
          select: { id: true }
        });
        if (inFlight) {
          throw new TaskExecutorError(
            "TASK_IN_PROGRESS",
            "Task already has an execution in progress"
          );
        }
        const attemptStats = await transaction.attempt.aggregate({
          where: { tenantId: command.tenant_id, taskId: command.task_id }
          ,
          _count: { _all: true },
          _max: { sequence: true }
        });
        const attemptCount = attemptStats._count._all;
        if (attemptCount >= task.attemptLimit) {
          const now = this.dependencies.clock();
          const taskUpdate = await transaction.task.updateMany({
            where: {
              tenantId: command.tenant_id,
              id: command.task_id,
              status: task.status
            },
            data: { status: "failed", updatedAt: now }
          });
          if (taskUpdate.count !== 1) {
            throw new TaskExecutorError(
              "CONCURRENT_UPDATE",
              "Task changed while applying attempt exhaustion"
            );
          }
          await this.transitionCase(
            transaction,
            task,
            task.case.status as ExecutableCaseStatus,
            "needs_human"
          );
          return { kind: "exhausted", task };
        }

        const effect: MedicalAppointmentEffect = {
          tenantId: command.tenant_id,
          caseId: command.case_id,
          taskId: command.task_id,
          type: command.type,
          subjectId: command.input.subject_id,
          counterpartyId: command.input.counterparty_id,
          consentId: command.consent_id
        };
        await this.dependencies
          .consentManager(transaction)
          .authorizeMedicalAppointmentEffect(effect);

        const now = this.dependencies.clock();
        const attemptId = this.dependencies.attemptId(
          command.tenant_id,
          command.idempotency_key
        );
        assertInternalId(attemptId, "Attempt");
        const attempt = await transaction.attempt.create({
          data: {
            id: attemptId,
            tenantId: command.tenant_id,
            taskId: command.task_id,
            sequence: (attemptStats._max.sequence ?? 0) + 1,
            channel: commandFingerprint(command, task.assignedAdapter),
            status: "started",
            idempotencyKey: command.idempotency_key,
            correlationId: command.correlation_id,
            startedAt: now,
            createdAt: now,
            updatedAt: now
          }
        });
        const updated = await transaction.task.updateMany({
          where: {
            tenantId: command.tenant_id,
            id: command.task_id,
            status: task.status
          },
          data: { status: "running", updatedAt: now }
        });
        if (updated.count !== 1) {
          throw new TaskExecutorError(
            "CONCURRENT_UPDATE",
            "Task changed while claiming an attempt"
          );
        }
        return { kind: "claimed", task, attempt, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    ));
  }

  private async recoverConcurrentIdempotency(command: TaskCommand): Promise<Claim> {
    return this.prisma.$transaction(async (transaction) => {
      await lockTask(transaction, command.tenant_id, command.task_id);
      const task = await findTask(transaction, command.tenant_id, command.task_id);
      if (!task) throw notFound();
      const existing = await transaction.attempt.findFirst({
        where: {
          tenantId: command.tenant_id,
          idempotencyKey: command.idempotency_key
        }
      });
      if (!existing) {
        throw new TaskExecutorError(
          "CONCURRENT_UPDATE",
          "Concurrent attempt could not be recovered"
        );
      }
      validateReplay(existing, task, command);
      return isTerminalAttempt(existing.status)
        ? { kind: "terminal_replay", task, attempt: existing }
        : { kind: "claimed", task, attempt: existing, replayed: true };
    });
  }

  private async persistResult(
    claim: ClaimedAttempt,
    result: AdapterResult
  ): Promise<TaskExecutionOutcome> {
    return withSerializationRetry(() => this.prisma.$transaction(async (transaction) => {
      await lockAttempt(transaction, claim.attempt.tenantId, claim.attempt.id);
      await lockTask(transaction, claim.attempt.tenantId, claim.attempt.taskId);
      const current = await transaction.attempt.findFirst({
        where: {
          tenantId: claim.attempt.tenantId,
          id: claim.attempt.id,
          taskId: claim.attempt.taskId
        }
      });
      if (!current) throw notFound();
      if (isTerminalAttempt(current.status)) {
        return this.reconstructTerminalOutcome(transaction, claim.task, current);
      }

      const mapping = mapResult(result, current.sequence, claim.task.attemptLimit);
      const now = this.dependencies.clock();
      const update = await transaction.attempt.updateMany({
        where: {
          tenantId: current.tenantId,
          id: current.id,
          taskId: current.taskId,
          status: { in: ["started", "waiting_external"] }
        },
        data: {
          status: mapping.attemptStatus,
          endedAt: mapping.attemptStatus === "waiting_external" ? null : now,
          failureCode: mapping.failureCode,
          retryable: mapping.retryable,
          externalReference: externalReference(result),
          updatedAt: now
        }
      });
      if (update.count !== 1) {
        const concurrent = await transaction.attempt.findFirst({
          where: { tenantId: current.tenantId, id: current.id }
        });
        if (concurrent && isTerminalAttempt(concurrent.status)) {
          return this.reconstructTerminalOutcome(transaction, claim.task, concurrent);
        }
        throw new TaskExecutorError(
          "CONCURRENT_UPDATE",
          "Attempt changed while persisting adapter result"
        );
      }

      const taskUpdate = await transaction.task.updateMany({
        where: {
          tenantId: current.tenantId,
          id: current.taskId,
          status: { in: ["running", "waiting_external"] }
        },
        data: { status: mapping.taskStatus, updatedAt: now }
      });
      if (taskUpdate.count !== 1) {
        throw new TaskExecutorError(
          "CONCURRENT_UPDATE",
          "Task changed while persisting adapter result"
        );
      }

      if (result.status === "succeeded") {
        for (const evidence of result.evidence) {
          await persistEvidence(
            transaction,
            this.dependencies,
            claim.task.caseId,
            claim.task.assignedAdapter,
            current,
            evidence
          );
        }
      }

      await this.applyCaseDecision(
        transaction,
        claim.task,
        result,
        mapping.decision
      );
      return {
        attempt: {
          ...current,
          status: mapping.attemptStatus,
          endedAt: mapping.attemptStatus === "waiting_external" ? null : now,
          failureCode: mapping.failureCode,
          retryable: mapping.retryable,
          externalReference: externalReference(result),
          updatedAt: now
        },
        result,
        decision: mapping.decision,
        ...(mapping.handoffReason
          ? { handoffReason: mapping.handoffReason }
          : {}),
        replayed: claim.replayed
      };
    }));
  }

  private async reconstructTerminalOutcome(
    database: Pick<TransactionClient, "artifact">,
    task: PersistedTask,
    attempt: Attempt
  ): Promise<TaskExecutionOutcome> {
    const evidence =
      attempt.status === "succeeded"
        ? await database.artifact.findMany({
            where: {
              tenantId: attempt.tenantId,
              caseId: task.caseId,
              storageKey: { startsWith: `adapter-evidence/${attempt.id}/` },
              verificationStatus: "verified"
            },
            orderBy: { storageKey: "asc" }
          })
        : [];
    const evidenceReferences = evidence.map((artifact) => ({
      type: artifact.type as "availability_options" | "appointment_confirmation",
      reference: artifact.storageKey.slice(
        `adapter-evidence/${attempt.id}/`.length
      ),
      checksum: artifact.checksum as `sha256:${string}`
    }));
    if (attempt.status === "succeeded") {
      const expectedType =
        task.type === "search_appointment"
          ? "availability_options"
          : "appointment_confirmation";
      const reconstructed = {
        status: "succeeded",
        external_reference: attempt.externalReference,
        evidence: evidenceReferences
      };
      try {
        assertAdapterResult(reconstructed);
      } catch {
        throw new TaskExecutorError(
          "EVIDENCE_INVALID",
          "Persisted successful attempt evidence is incomplete"
        );
      }
      if (reconstructed.evidence.some((item) => item.type !== expectedType)) {
        throw new TaskExecutorError(
          "EVIDENCE_INVALID",
          "Persisted evidence type does not match the task"
        );
      }
    }
    const { result, decision, handoffReason } = resultFromTerminalAttempt(
      attempt,
      task.attemptLimit,
      evidenceReferences
    );
    return {
      attempt,
      result,
      decision,
      ...(handoffReason ? { handoffReason } : {}),
      replayed: true
    };
  }

  private async applyCaseDecision(
    transaction: TransactionClient,
    task: PersistedTask,
    result: AdapterResult,
    decision: TaskExecutionDecision
  ): Promise<void> {
    let target: "waiting_external" | "needs_user" | "needs_human" | null = null;
    if (result.status === "waiting_external") target = "waiting_external";
    else if (result.status === "needs_user") target = "needs_user";
    else if (result.status === "needs_human") target = "needs_human";
    else if (result.status === "succeeded" && task.type === "search_appointment") {
      target = "needs_user";
    } else if (result.status === "failed" && decision !== "retry_scheduled") {
      target =
        result.retryable
          ? "needs_human"
          : result.failure_code === "NO_AVAILABILITY" ||
              result.failure_code === "INVALID_REQUEST" ||
              result.failure_code === "CONSENT_INVALID"
          ? "needs_user"
          : "needs_human";
    }
    if (result.status === "succeeded" && task.type === "book_appointment") {
      if (task.case.status === "waiting_external") {
        await this.transitionCase(
          transaction,
          task,
          "waiting_external",
          "executing"
        );
      }
      return;
    }
    if (target) {
      await this.transitionCase(
        transaction,
        task,
        task.case.status as ExecutableCaseStatus,
        target
      );
    }
  }

  private async transitionCase(
    transaction: TransactionClient,
    task: PersistedTask,
    fromStatus: ExecutableCaseStatus,
    target: "executing" | "waiting_external" | "needs_user" | "needs_human"
  ): Promise<void> {
    const input: TransitionCaseInput = {
      tenantId: task.tenantId,
      caseId: task.caseId,
      fromStatus,
      toStatus: target
    };
    try {
      await this.dependencies.caseManager(transaction).transition(input);
    } catch (error) {
      if (
        error instanceof CaseManagerError &&
        error.code === "CONCURRENT_UPDATE"
      ) {
        throw new TaskExecutorError(
          "CONCURRENT_UPDATE",
          "Case changed while applying execution outcome"
        );
      }
      throw error;
    }
  }
}

async function lockTask(
  transaction: TransactionClient,
  tenantId: string,
  taskId: string
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Task"
      WHERE "tenantId" = ${tenantId} AND "id" = ${taskId}
      FOR UPDATE`
  );
}

async function lockConsent(
  transaction: TransactionClient,
  tenantId: string,
  caseId: string,
  consentId: string
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Consent"
      WHERE "tenantId" = ${tenantId}
        AND "caseId" = ${caseId}
        AND "id" = ${consentId}
      FOR UPDATE`
  );
}

async function lockAttempt(
  transaction: TransactionClient,
  tenantId: string,
  attemptId: string
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Attempt"
      WHERE "tenantId" = ${tenantId} AND "id" = ${attemptId}
      FOR UPDATE`
  );
}

async function findTask(
  transaction: TransactionClient,
  tenantId: string,
  taskId: string
): Promise<PersistedTask | null> {
  return transaction.task.findFirst({
    where: { tenantId, id: taskId },
    include: {
      case: {
        select: {
          id: true,
          tenantId: true,
          subjectId: true,
          counterpartyId: true,
          type: true,
          status: true
        }
      }
    }
  });
}

function validateExecutableAggregate(task: PersistedTask, command: TaskCommand): void {
  if (
    task.caseId !== command.case_id ||
    task.type !== command.type ||
    task.case.tenantId !== command.tenant_id ||
    task.case.type !== "medical_appointment" ||
    task.case.subjectId !== command.input.subject_id ||
    !task.case.counterpartyId ||
    task.case.counterpartyId !== command.input.counterparty_id
  ) {
    throw new TaskExecutorError(
      "INVALID_COMMAND",
      "Command does not match the persisted task aggregate"
    );
  }
  if (
    task.case.status !== "executing" &&
    task.case.status !== "waiting_external"
  ) {
    throw new TaskExecutorError(
      "TASK_NOT_EXECUTABLE",
      "Case is not executable"
    );
  }
  if (
    task.status !== "pending" &&
    task.status !== "running" &&
    task.status !== "waiting_external"
  ) {
    throw new TaskExecutorError(
      "TASK_NOT_EXECUTABLE",
      "Task is terminal or unsupported"
    );
  }
  if (!Number.isInteger(task.attemptLimit) || task.attemptLimit <= 0) {
    throw new TaskExecutorError(
      "TASK_NOT_EXECUTABLE",
      "Task has an invalid attempt limit"
    );
  }
}

function validateReplay(
  attempt: Attempt,
  task: PersistedTask,
  command: TaskCommand
): void {
  if (
    attempt.taskId !== task.id ||
    task.caseId !== command.case_id ||
    task.type !== command.type ||
    attempt.correlationId !== command.correlation_id ||
    attempt.sequence < 1 ||
    attempt.sequence > task.attemptLimit ||
    attempt.channel !== commandFingerprint(command, task.assignedAdapter)
  ) {
    throw new TaskExecutorError(
      "IDEMPOTENCY_KEY_CONFLICT",
      "Idempotency key is associated with a different execution"
    );
  }
}

function verifySuccessfulEvidence(
  adapter: AppointmentAdapterRegistry[string],
  taskType: string,
  result: AdapterResult
): AdapterResult {
  if (result.status === "succeeded") {
    const expectedType =
      taskType === "search_appointment"
        ? "availability_options"
        : "appointment_confirmation";
    if (
      result.evidence.some((evidence) => {
        const material = adapter.getEvidence(evidence.reference);
        return (
          evidence.type !== expectedType ||
          material?.type !== evidence.type ||
          material.reference !== evidence.reference ||
          !adapter.verifyEvidence(evidence.reference, evidence.checksum)
        );
      })
    ) {
      return { status: "needs_human", reason_code: "UNSUPPORTED_RESPONSE" };
    }
  }
  return result;
}

function mapResult(
  result: AdapterResult,
  sequence: number,
  attemptLimit: number
): {
  attemptStatus: "waiting_external" | "succeeded" | "failed";
  taskStatus: "waiting_external" | "completed" | "pending" | "failed";
  failureCode: string | null;
  retryable: boolean | null;
  decision: TaskExecutionDecision;
  handoffReason?: "ATTEMPTS_EXHAUSTED";
} {
  switch (result.status) {
    case "succeeded":
      return {
        attemptStatus: "succeeded",
        taskStatus: "completed",
        failureCode: null,
        retryable: null,
        decision: "completed"
      };
    case "waiting_external":
      return {
        attemptStatus: "waiting_external",
        taskStatus: "waiting_external",
        failureCode: null,
        retryable: null,
        decision: "waiting_external"
      };
    case "failed": {
      const retry = result.retryable && sequence < attemptLimit;
      const needsUser = ["NO_AVAILABILITY", "INVALID_REQUEST", "CONSENT_INVALID"].includes(
        result.failure_code
      );
      return {
        attemptStatus: "failed",
        taskStatus: retry ? "pending" : "failed",
        failureCode: result.failure_code,
        retryable: result.retryable,
        decision: retry
          ? "retry_scheduled"
          : result.retryable
            ? "needs_human"
          : needsUser
            ? "needs_user"
            : "needs_human",
        ...(result.retryable && !retry
          ? { handoffReason: "ATTEMPTS_EXHAUSTED" as const }
          : {})
      };
    }
    case "needs_user":
      return {
        attemptStatus: "failed",
        taskStatus: "pending",
        failureCode: `NEEDS_USER:${[...result.missing_fields].sort().join(",")}`,
        retryable: false,
        decision: "needs_user"
      };
    case "needs_human":
      return {
        attemptStatus: "failed",
        taskStatus: "failed",
        failureCode: `NEEDS_HUMAN:${result.reason_code}`,
        retryable: false,
        decision: "needs_human"
      };
  }
}

function resultFromTerminalAttempt(
  attempt: Attempt,
  attemptLimit: number,
  evidence: Extract<AdapterResult, { status: "succeeded" }>["evidence"]
): {
  result: AdapterResult;
  decision: TaskExecutionDecision;
  handoffReason?: "ATTEMPTS_EXHAUSTED";
} {
  if (attempt.status === "succeeded") {
    return {
      result: {
        status: "succeeded",
        external_reference: attempt.externalReference ?? "missing:external-reference",
        evidence
      },
      decision: "completed"
    };
  }
  const code = attempt.failureCode ?? "UNKNOWN";
  if (code.startsWith("NEEDS_USER:")) {
    const missing = code
      .slice("NEEDS_USER:".length)
      .split(",")
      .filter(Boolean) as Extract<AdapterResult, { status: "needs_user" }>["missing_fields"];
    return {
      result: { status: "needs_user", missing_fields: missing },
      decision: "needs_user"
    };
  }
  if (code.startsWith("NEEDS_HUMAN:")) {
    const reason = code.slice("NEEDS_HUMAN:".length) as Extract<
      AdapterResult,
      { status: "needs_human" }
    >["reason_code"];
    return {
      result: { status: "needs_human", reason_code: reason },
      decision: "needs_human"
    };
  }
  const result: AdapterResult = {
    status: "failed",
    failure_code: asFailureCode(code),
    retryable: attempt.retryable ?? false
  };
  return {
    result,
    decision:
      result.retryable && attempt.sequence < attemptLimit
        ? "retry_scheduled"
        : result.retryable
          ? "needs_human"
        : ["NO_AVAILABILITY", "INVALID_REQUEST", "CONSENT_INVALID"].includes(
              result.failure_code
            )
          ? "needs_user"
          : "needs_human",
    ...(result.retryable && attempt.sequence >= attemptLimit
      ? { handoffReason: "ATTEMPTS_EXHAUSTED" as const }
      : {})
  };
}

async function persistEvidence(
  transaction: TransactionClient,
  dependencies: TaskExecutorDependencies,
  caseId: string,
  adapterName: string,
  attempt: Attempt,
  evidence: Extract<AdapterResult, { status: "succeeded" }>["evidence"][number]
): Promise<void> {
  const storageKey = `adapter-evidence/${attempt.id}/${evidence.reference}`;
  const existing = await transaction.artifact.findFirst({
    where: { tenantId: attempt.tenantId, storageKey }
  });
  if (existing) {
    if (
      existing.caseId !== caseId ||
      existing.type !== evidence.type ||
      existing.checksum !== evidence.checksum ||
      existing.verificationStatus !== "verified"
    ) {
      throw new TaskExecutorError(
        "EVIDENCE_INVALID",
        "Evidence reference conflicts with persisted artifact"
      );
    }
    return;
  }
  try {
    const artifactId = dependencies.artifactId(
      attempt.tenantId,
      attempt.id,
      evidence.reference
    );
    assertInternalId(artifactId, "Artifact");
    await transaction.artifact.create({
      data: {
        id: artifactId,
        tenantId: attempt.tenantId,
        caseId,
        type: evidence.type,
        storageKey,
        mimeType: "application/json",
        checksum: evidence.checksum,
        source: adapterName,
        verificationStatus: "verified",
        createdAt: dependencies.clock()
      }
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrent = await transaction.artifact.findFirst({
      where: { tenantId: attempt.tenantId, storageKey }
    });
    if (
      concurrent?.caseId === caseId &&
      concurrent.type === evidence.type &&
      concurrent.checksum === evidence.checksum &&
      concurrent.verificationStatus === "verified"
    ) {
      return;
    }
    throw new TaskExecutorError(
      "EVIDENCE_INVALID",
      "Evidence could not be persisted idempotently"
    );
  }
}

function externalReference(result: AdapterResult): string | null {
  return result.status === "succeeded" || result.status === "waiting_external"
    ? result.external_reference ?? null
    : null;
}

function isTerminalAttempt(status: string): boolean {
  return status === "succeeded" || status === "failed";
}

function asFailureCode(
  value: string
): Extract<AdapterResult, { status: "failed" }>["failure_code"] {
  return [
    "NO_AVAILABILITY",
    "COUNTERPARTY_UNAVAILABLE",
    "INVALID_REQUEST",
    "CONSENT_INVALID",
    "DUPLICATE_REQUEST",
    "UNKNOWN"
  ].includes(value)
    ? (value as Extract<AdapterResult, { status: "failed" }>["failure_code"])
    : "UNKNOWN";
}

function translateConsentError(error: unknown): unknown {
  if (error instanceof ConsentManagerError) {
    if (error.code === "NOT_FOUND") return notFound();
    if (error.code === "NOT_AUTHORIZED") {
      return new TaskExecutorError(
        "NOT_AUTHORIZED",
        "Execution is not authorized"
      );
    }
    return new TaskExecutorError(
      "CONCURRENT_UPDATE",
      "Consent changed while claiming execution"
    );
  }
  return error;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function notFound(): TaskExecutorError {
  return new TaskExecutorError("NOT_FOUND", "Resource not found for tenant");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function withSerializationRetry<T>(
  operation: () => Promise<T>
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationConflict(error)) throw error;
      if (attempt === maxAttempts) {
        throw new TaskExecutorError(
          "CONCURRENT_UPDATE",
          "Serializable transaction retry limit was exhausted"
        );
      }
    }
  }
  throw new TaskExecutorError(
    "CONCURRENT_UPDATE",
    "Serializable transaction retry limit was exhausted"
  );
}

function isSerializationConflict(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.code === "P2034") return true;
  return (
    error.code === "P2010" &&
    isRecord(error.meta) &&
    error.meta.code === "40001"
  );
}

function assertAdapterResult(value: unknown): asserts value is AdapterResult {
  if (!isRecord(value) || typeof value.status !== "string") invalidAdapterResult();
  switch (value.status) {
    case "succeeded":
      if (
        !hasOnlyKeys(value, ["status", "external_reference", "evidence"]) ||
        !isIdentifier(value.external_reference) ||
        !Array.isArray(value.evidence) ||
        value.evidence.length === 0 ||
        value.evidence.some(
          (entry) =>
            !isRecord(entry) ||
            !hasOnlyKeys(entry, ["type", "reference", "checksum"]) ||
            (entry.type !== "availability_options" &&
              entry.type !== "appointment_confirmation") ||
            !isIdentifier(entry.reference) ||
            typeof entry.checksum !== "string" ||
            !/^sha256:[a-f0-9]{64}$/.test(entry.checksum)
        )
      ) {
        invalidAdapterResult();
      }
      return;
    case "waiting_external":
      if (
        !hasOnlyKeys(value, [
          "status",
          ...(value.resume_after === undefined ? [] : ["resume_after"]),
          ...(value.external_reference === undefined ? [] : ["external_reference"])
        ]) ||
        (value.external_reference !== undefined &&
          !isIdentifier(value.external_reference)) ||
        (value.resume_after !== undefined &&
          (typeof value.resume_after !== "string" ||
            !parseRfc3339DateTime(value.resume_after)))
      ) {
        invalidAdapterResult();
      }
      return;
    case "failed":
      if (
        !hasOnlyKeys(value, ["status", "failure_code", "retryable"]) ||
        ![
          "NO_AVAILABILITY",
          "COUNTERPARTY_UNAVAILABLE",
          "INVALID_REQUEST",
          "CONSENT_INVALID",
          "DUPLICATE_REQUEST",
          "UNKNOWN"
        ].includes(
          typeof value.failure_code === "string" ? value.failure_code : ""
        ) ||
        typeof value.retryable !== "boolean"
      ) {
        invalidAdapterResult();
      }
      return;
    case "needs_user": {
      const allowed = new Set([
        "subject",
        "preferred_date_range",
        "preferred_time_range",
        "coverage",
        "slot_id"
      ]);
      if (
        !hasOnlyKeys(value, ["status", "missing_fields"]) ||
        !Array.isArray(value.missing_fields) ||
        value.missing_fields.length === 0 ||
        new Set(value.missing_fields).size !== value.missing_fields.length ||
        value.missing_fields.some(
          (field) => typeof field !== "string" || !allowed.has(field)
        )
      ) {
        invalidAdapterResult();
      }
      return;
    }
    case "needs_human":
      if (
        !hasOnlyKeys(value, ["status", "reason_code"]) ||
        ![
          "ATTEMPTS_EXHAUSTED",
          "POLICY_REQUIRES_HUMAN",
          "COUNTERPARTY_REQUIRES_CALL",
          "UNSUPPORTED_RESPONSE"
        ].includes(typeof value.reason_code === "string" ? value.reason_code : "")
      ) {
        invalidAdapterResult();
      }
      return;
    default:
      invalidAdapterResult();
  }
}

function invalidAdapterResult(): never {
  throw new TaskExecutorError(
    "INVALID_COMMAND",
    "Adapter returned an invalid structured result"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return (
    actual.length === allowed.length &&
    actual.every((key, index) => key === allowed[index])
  );
}

function assertInternalId(value: string, entity: string): void {
  if (
    value.length < 3 ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new TaskExecutorError(
      "INVALID_COMMAND",
      `${entity} identifier generator returned an invalid value`
    );
  }
}

function commandFingerprint(command: TaskCommand, adapterName: string): string {
  return `exec:${hash(
    JSON.stringify(canonicalize({ command, adapter: adapterName }))
  )}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

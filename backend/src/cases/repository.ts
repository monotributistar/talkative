import { nanoid } from "nanoid";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  AppendConversationTurnInput,
  CaseEntityKind,
  CaseRepositoryError,
  CreateArtifactInput,
  CreateAttemptInput,
  CreateCalendarProjectionInput,
  CreateCaseInput,
  CreateConversationInput,
  CreateDelegationInput,
  CreatePrincipalInput,
  CreateSubjectInput,
  CreateTaskInput,
  RepositoryDependencies
} from "./types.js";

const dossierInclude = {
  principal: true,
  subject: true,
  fields: { orderBy: { createdAt: "asc" } },
  conversations: {
    orderBy: { startedAt: "asc" },
    include: {
      turns: { orderBy: { createdAt: "asc" } }
    }
  },
  tasks: {
    orderBy: { createdAt: "asc" },
    include: {
      attempts: { orderBy: { sequence: "asc" } }
    }
  },
  consents: { orderBy: { createdAt: "asc" } },
  artifacts: { orderBy: { createdAt: "asc" } },
  calendarProjections: { orderBy: { createdAt: "asc" } }
} satisfies Prisma.CaseInclude;

export type CaseDossier = Prisma.CaseGetPayload<{ include: typeof dossierInclude }> & {
  delegations: Array<Prisma.DelegationGetPayload<Record<string, never>>>;
};

type CasePrismaClient = Pick<
  PrismaClient,
  | "principal"
  | "subject"
  | "delegation"
  | "conversation"
  | "conversationTurn"
  | "case"
  | "task"
  | "attempt"
  | "artifact"
  | "calendarProjection"
>;

const defaultDependencies: RepositoryDependencies = {
  clock: () => new Date(),
  idGenerator: (entity: CaseEntityKind) => `${entity}-${nanoid(12)}`
};

/**
 * Persistence boundary for the basic case dossier.
 *
 * Every public operation requires tenantId. References are resolved with the
 * tenant in the predicate, while composite foreign keys provide a second line
 * of defense at the database layer.
 */
export class PrismaCaseRepository {
  private readonly dependencies: RepositoryDependencies;

  constructor(
    private readonly prisma: CasePrismaClient,
    dependencies: Partial<RepositoryDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async createPrincipal(input: CreatePrincipalInput) {
    const now = this.dependencies.clock();
    return this.prisma.principal.create({
      data: {
        id: this.dependencies.idGenerator("principal"),
        tenantId: input.tenantId,
        displayName: input.displayName,
        locale: input.locale,
        timezone: input.timezone,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  async createSubject(input: CreateSubjectInput) {
    await this.requirePrincipal(input.tenantId, input.principalId);
    const now = this.dependencies.clock();
    return this.prisma.subject.create({
      data: {
        id: this.dependencies.idGenerator("subject"),
        tenantId: input.tenantId,
        principalId: input.principalId,
        relationship: input.relationship,
        displayName: input.displayName,
        birthDate: input.birthDate,
        relationshipVerifiedAt: input.relationshipVerifiedAt,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  async createDelegation(input: CreateDelegationInput) {
    await this.requireSubjectForPrincipal(input.tenantId, input.subjectId, input.principalId);
    const now = this.dependencies.clock();
    return this.prisma.delegation.create({
      data: {
        id: this.dependencies.idGenerator("delegation"),
        tenantId: input.tenantId,
        principalId: input.principalId,
        subjectId: input.subjectId,
        scope: input.scope,
        status: input.status ?? "active",
        validFrom: input.validFrom ?? now,
        validUntil: input.validUntil,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  async createCase(input: CreateCaseInput) {
    await this.requireSubjectForPrincipal(input.tenantId, input.subjectId, input.principalId);
    const now = this.dependencies.clock();
    return this.prisma.case.create({
      data: {
        id: this.dependencies.idGenerator("case"),
        tenantId: input.tenantId,
        principalId: input.principalId,
        subjectId: input.subjectId,
        type: input.type,
        goal: input.goal,
        status: "draft",
        priority: input.priority ?? 0,
        counterpartyId: input.counterpartyId,
        dueAt: input.dueAt,
        createdAt: now,
        updatedAt: now,
        fields: input.fields
          ? {
              create: input.fields.map((field) => ({
                id: this.dependencies.idGenerator("field"),
                tenantId: input.tenantId,
                key: field.key,
                valueEncrypted: field.valueEncrypted,
                source: field.source,
                confidence: field.confidence,
                confirmedAt: field.confirmedAt,
                createdAt: now,
                updatedAt: now
              }))
            }
          : undefined
      }
    });
  }

  async createConversation(input: CreateConversationInput) {
    await this.requirePrincipal(input.tenantId, input.principalId);
    if (input.caseId) {
      const caseRecord = await this.prisma.case.findFirst({
        where: { tenantId: input.tenantId, id: input.caseId }
      });
      if (!caseRecord) {
        throw new CaseRepositoryError("CASE_NOT_FOUND", "Case not found for tenant");
      }
      if (caseRecord.principalId !== input.principalId) {
        throw new CaseRepositoryError(
          "CASE_PRINCIPAL_MISMATCH",
          "Conversation principal does not own the case"
        );
      }
    }

    const now = this.dependencies.clock();
    return this.prisma.conversation.create({
      data: {
        id: this.dependencies.idGenerator("conversation"),
        tenantId: input.tenantId,
        principalId: input.principalId,
        caseId: input.caseId,
        channel: input.channel,
        status: input.status ?? "active",
        startedAt: now,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  async appendConversationTurn(input: AppendConversationTurnInput) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { tenantId: input.tenantId, id: input.conversationId }
    });
    if (!conversation) {
      throw new CaseRepositoryError(
        "CONVERSATION_NOT_FOUND",
        "Conversation not found for tenant"
      );
    }

    const now = this.dependencies.clock();
    const turn = await this.prisma.conversationTurn.create({
      data: {
        id: this.dependencies.idGenerator("turn"),
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        actor: input.actor,
        modality: input.modality,
        text: input.text,
        transcriptConfidence: input.transcriptConfidence,
        correlationId: input.correlationId,
        createdAt: now
      }
    });
    await this.prisma.conversation.update({
      where: {
        tenantId_id: {
          tenantId: input.tenantId,
          id: input.conversationId
        }
      },
      data: { lastTurnAt: now, updatedAt: now }
    });
    return turn;
  }

  async createTask(input: CreateTaskInput) {
    await this.requireCase(input.tenantId, input.caseId);
    const now = this.dependencies.clock();
    return this.prisma.task.create({
      data: {
        id: this.dependencies.idGenerator("task"),
        tenantId: input.tenantId,
        caseId: input.caseId,
        type: input.type,
        status: input.status ?? "pending",
        requiredInputs: input.requiredInputs,
        outputContract: input.outputContract as Prisma.InputJsonValue,
        attemptLimit: input.attemptLimit,
        assignedAdapter: input.assignedAdapter,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  async createAttemptIdempotent(input: CreateAttemptInput) {
    const existing = await this.findAttemptByIdempotencyKey(
      input.tenantId,
      input.idempotencyKey
    );
    if (existing) {
      if (!matchesAttemptRequest(existing, input)) {
        throw new CaseRepositoryError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "Idempotency key is already associated with a different attempt request"
        );
      }
      return existing;
    }

    await this.requireTask(input.tenantId, input.taskId);
    const now = this.dependencies.clock();
    try {
      return await this.prisma.attempt.create({
        data: {
          id: this.dependencies.idGenerator("attempt"),
          tenantId: input.tenantId,
          taskId: input.taskId,
          sequence: input.sequence,
          channel: input.channel,
          status: input.status ?? "started",
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
          startedAt: now,
          endedAt: input.endedAt,
          failureCode: input.failureCode,
          retryable: input.retryable,
          externalReference: input.externalReference,
          createdAt: now,
          updatedAt: now
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrent = await this.findAttemptByIdempotencyKey(
        input.tenantId,
        input.idempotencyKey
      );
      if (concurrent && matchesAttemptRequest(concurrent, input)) return concurrent;
      throw new CaseRepositoryError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "Attempt uniqueness constraint rejected the operation"
      );
    }
  }

  async createArtifact(input: CreateArtifactInput) {
    await this.requireCase(input.tenantId, input.caseId);
    return this.prisma.artifact.create({
      data: {
        id: this.dependencies.idGenerator("artifact"),
        tenantId: input.tenantId,
        caseId: input.caseId,
        type: input.type,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        checksum: input.checksum,
        source: input.source,
        verificationStatus: input.verificationStatus ?? "pending",
        createdAt: this.dependencies.clock()
      }
    });
  }

  async createCalendarProjectionIdempotent(input: CreateCalendarProjectionInput) {
    const existing = await this.findCalendarProjectionConflict(input);
    if (existing) {
      if (
        existing.caseId === input.caseId &&
        existing.provider === input.provider &&
        existing.eventKey === input.eventKey &&
        existing.idempotencyKey === input.idempotencyKey &&
        matchesCalendarProjectionRequest(existing, input)
      ) {
        return existing;
      }
      throw new CaseRepositoryError(
        "CALENDAR_PROJECTION_CONFLICT",
        "A calendar projection already owns this case, event or idempotency key"
      );
    }

    await this.requireCase(input.tenantId, input.caseId);
    const now = this.dependencies.clock();
    try {
      return await this.prisma.calendarProjection.create({
        data: {
          id: this.dependencies.idGenerator("calendar_projection"),
          tenantId: input.tenantId,
          caseId: input.caseId,
          provider: input.provider,
          eventKey: input.eventKey,
          externalEventId: input.externalEventId,
          idempotencyKey: input.idempotencyKey,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          syncStatus: input.syncStatus ?? "pending",
          failureCode: input.failureCode,
          lastSyncedAt: input.lastSyncedAt,
          createdAt: now,
          updatedAt: now
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrent = await this.findCalendarProjectionConflict(input);
      if (
        concurrent &&
        concurrent.caseId === input.caseId &&
        concurrent.provider === input.provider &&
        concurrent.eventKey === input.eventKey &&
        concurrent.idempotencyKey === input.idempotencyKey &&
        matchesCalendarProjectionRequest(concurrent, input)
      ) {
        return concurrent;
      }
      throw new CaseRepositoryError(
        "CALENDAR_PROJECTION_CONFLICT",
        "Calendar projection uniqueness constraint rejected the operation"
      );
    }
  }

  async getCase(tenantId: string, caseId: string): Promise<CaseDossier | null> {
    const caseRecord = await this.prisma.case.findFirst({
      where: { tenantId, id: caseId },
      include: dossierInclude
    });
    if (!caseRecord) return null;

    const delegations = await this.prisma.delegation.findMany({
      where: {
        tenantId,
        principalId: caseRecord.principalId,
        subjectId: caseRecord.subjectId
      },
      orderBy: { createdAt: "asc" }
    });
    return { ...caseRecord, delegations };
  }

  private async requireCase(tenantId: string, caseId: string) {
    const caseRecord = await this.prisma.case.findFirst({
      where: { tenantId, id: caseId },
      select: { id: true }
    });
    if (!caseRecord) {
      throw new CaseRepositoryError("CASE_NOT_FOUND", "Case not found for tenant");
    }
    return caseRecord;
  }

  private async requireTask(tenantId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { tenantId, id: taskId },
      select: { id: true }
    });
    if (!task) {
      throw new CaseRepositoryError("TASK_NOT_FOUND", "Task not found for tenant");
    }
    return task;
  }

  private findAttemptByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.prisma.attempt.findUnique({
      where: {
        tenantId_idempotencyKey: { tenantId, idempotencyKey }
      }
    });
  }

  private async findCalendarProjectionConflict(input: CreateCalendarProjectionInput) {
    const byIdempotency = await this.prisma.calendarProjection.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: input.tenantId,
          idempotencyKey: input.idempotencyKey
        }
      }
    });
    if (byIdempotency) return byIdempotency;

    const byEvent = await this.prisma.calendarProjection.findUnique({
      where: {
        tenantId_provider_eventKey: {
          tenantId: input.tenantId,
          provider: input.provider,
          eventKey: input.eventKey
        }
      }
    });
    if (byEvent) return byEvent;

    return this.prisma.calendarProjection.findUnique({
      where: {
        tenantId_caseId_provider: {
          tenantId: input.tenantId,
          caseId: input.caseId,
          provider: input.provider
        }
      }
    });
  }

  private async requirePrincipal(tenantId: string, principalId: string): Promise<void> {
    const principal = await this.prisma.principal.findFirst({
      where: { tenantId, id: principalId },
      select: { id: true }
    });
    if (!principal) {
      throw new CaseRepositoryError("PRINCIPAL_NOT_FOUND", "Principal not found for tenant");
    }
  }

  private async requireSubjectForPrincipal(
    tenantId: string,
    subjectId: string,
    principalId: string
  ): Promise<void> {
    const subject = await this.prisma.subject.findFirst({
      where: { tenantId, id: subjectId },
      select: { principalId: true }
    });
    if (!subject) {
      throw new CaseRepositoryError("SUBJECT_NOT_FOUND", "Subject not found for tenant");
    }
    if (subject.principalId !== principalId) {
      throw new CaseRepositoryError(
        "SUBJECT_PRINCIPAL_MISMATCH",
        "Subject does not belong to the indicated principal"
      );
    }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function matchesAttemptRequest(
  existing: {
    taskId: string;
    sequence: number;
    channel: string;
    correlationId: string;
  },
  input: CreateAttemptInput
): boolean {
  return (
    existing.taskId === input.taskId &&
    existing.sequence === input.sequence &&
    existing.channel === input.channel &&
    existing.correlationId === input.correlationId
  );
}

function matchesCalendarProjectionRequest(
  existing: {
    externalEventId: string | null;
    startsAt: Date;
    endsAt: Date;
  },
  input: CreateCalendarProjectionInput
): boolean {
  return (
    existing.externalEventId === (input.externalEventId ?? null) &&
    existing.startsAt.getTime() === input.startsAt.getTime() &&
    existing.endsAt.getTime() === input.endsAt.getTime()
  );
}

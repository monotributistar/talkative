import type { PrismaClient } from "@prisma/client";
import {
  type MedicalAppointmentCompletion,
  validateMedicalAppointmentCompletion
} from "./completion-validator.js";
import { parseRfc3339DateTime } from "./rfc3339.js";
import type { CaseStatus } from "./types.js";

const TERMINAL_STATUSES = new Set<CaseStatus>(["completed", "cancelled", "expired"]);

const ALLOWED_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  draft: ["collecting_information", "cancelled"],
  collecting_information: [
    "ready_for_confirmation",
    "needs_user",
    "needs_human",
    "cancelled",
    "expired"
  ],
  ready_for_confirmation: [
    "collecting_information",
    "executing",
    "cancelled",
    "expired"
  ],
  executing: ["waiting_external", "needs_user", "needs_human", "blocked", "cancelled"],
  waiting_external: [
    "executing",
    "needs_user",
    "needs_human",
    "blocked",
    "cancelled",
    "expired"
  ],
  completed: [],
  needs_user: [
    "collecting_information",
    "ready_for_confirmation",
    "executing",
    "cancelled",
    "expired"
  ],
  needs_human: ["executing", "blocked", "cancelled", "expired"],
  blocked: ["executing", "needs_human", "cancelled", "expired"],
  cancelled: [],
  expired: []
};

type CaseManagerPrisma = Pick<
  PrismaClient,
  "case" | "attempt" | "artifact" | "calendarProjection"
>;

export interface CaseManagerDependencies {
  clock: () => Date;
}

export interface TransitionCaseInput {
  tenantId: string;
  caseId: string;
  fromStatus: CaseStatus;
  toStatus: CaseStatus;
}

export interface CompleteMedicalAppointmentInput {
  tenantId: string;
  caseId: string;
  fromStatus: "executing" | "waiting_external";
  completion: unknown;
}

export type CaseManagerErrorCode =
  | "CASE_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INVALID_EVIDENCE"
  | "CONCURRENT_UPDATE";

export class CaseManagerError extends Error {
  constructor(
    public readonly code: CaseManagerErrorCode,
    message: string,
    public readonly details: readonly string[] = []
  ) {
    super(message);
    this.name = "CaseManagerError";
  }
}

const defaultDependencies: CaseManagerDependencies = {
  clock: () => new Date()
};

export class CaseManager {
  private readonly dependencies: CaseManagerDependencies;

  constructor(
    private readonly prisma: CaseManagerPrisma,
    dependencies: Partial<CaseManagerDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async transition(input: TransitionCaseInput) {
    const current = await this.findCase(input.tenantId, input.caseId);
    if (current.status !== input.fromStatus) {
      throw new CaseManagerError(
        "CONCURRENT_UPDATE",
        "Case status changed before the requested transition"
      );
    }
    if (input.toStatus === "completed") {
      throw new CaseManagerError(
        "INVALID_TRANSITION",
        "Only completeMedicalAppointment may complete a case"
      );
    }
    if (input.toStatus === current.status) return current;
    if (
      TERMINAL_STATUSES.has(current.status) ||
      !ALLOWED_TRANSITIONS[current.status].includes(input.toStatus)
    ) {
      throw new CaseManagerError(
        "INVALID_TRANSITION",
        `Transition from ${current.status} to ${input.toStatus} is not allowed`
      );
    }

    const now = this.dependencies.clock();
    const result = await this.prisma.case.updateMany({
      where: {
        tenantId: input.tenantId,
        id: input.caseId,
        status: input.fromStatus
      },
      data: {
        status: input.toStatus,
        updatedAt: now
      }
    });
    if (result.count !== 1) {
      throw new CaseManagerError(
        "CONCURRENT_UPDATE",
        "Case status changed while applying the requested transition"
      );
    }
    return {
      ...current,
      status: input.toStatus,
      updatedAt: now
    };
  }

  async completeMedicalAppointment(input: CompleteMedicalAppointmentInput) {
    const validation = validateMedicalAppointmentCompletion(input.completion);
    if (!validation.valid) {
      throw new CaseManagerError(
        "INVALID_EVIDENCE",
        "Completion evidence does not satisfy MedicalAppointmentCompletion v1",
        validation.errors
      );
    }
    const completion = input.completion as MedicalAppointmentCompletion;
    if (
      completion.tenant_id !== input.tenantId ||
      completion.case_id !== input.caseId
    ) {
      throw new CaseManagerError(
        "INVALID_EVIDENCE",
        "Completion evidence does not identify the requested tenant and case"
      );
    }

    const current = await this.findCase(input.tenantId, input.caseId);
    if (current.type !== "medical_appointment") {
      throw new CaseManagerError(
        "INVALID_EVIDENCE",
        "Completion contract does not match the persisted case type"
      );
    }

    await this.verifyPersistedEvidence(input.tenantId, input.caseId, completion);

    if (current.status === "completed") return current;
    if (current.status !== "executing" && current.status !== "waiting_external") {
      throw new CaseManagerError(
        "INVALID_TRANSITION",
        `A medical appointment cannot be completed from ${current.status}`
      );
    }
    if (current.status !== input.fromStatus) {
      throw new CaseManagerError(
        "CONCURRENT_UPDATE",
        "Case status changed before completion"
      );
    }

    const now = this.dependencies.clock();
    const result = await this.prisma.case.updateMany({
      where: {
        tenantId: input.tenantId,
        id: input.caseId,
        status: input.fromStatus
      },
      data: {
        status: "completed",
        completedAt: now,
        updatedAt: now
      }
    });
    if (result.count !== 1) {
      throw new CaseManagerError(
        "CONCURRENT_UPDATE",
        "Case status changed while applying completion"
      );
    }
    return {
      ...current,
      status: "completed" as const,
      completedAt: now,
      updatedAt: now
    };
  }

  private async findCase(tenantId: string, caseId: string) {
    const current = await this.prisma.case.findFirst({
      where: { tenantId, id: caseId },
      select: {
        id: true,
        tenantId: true,
        type: true,
        status: true,
        updatedAt: true,
        completedAt: true
      }
    });
    if (!current) {
      throw new CaseManagerError("CASE_NOT_FOUND", "Case not found for tenant");
    }
    if (!isCaseStatus(current.status)) {
      throw new CaseManagerError(
        "INVALID_TRANSITION",
        "Persisted case has an unsupported status"
      );
    }
    return { ...current, status: current.status };
  }

  private async verifyPersistedEvidence(
    tenantId: string,
    caseId: string,
    completion: MedicalAppointmentCompletion
  ): Promise<void> {
    const attempt = await this.prisma.attempt.findFirst({
      where: {
        tenantId,
        id: completion.attempt.attempt_id,
        status: "succeeded",
        externalReference: completion.attempt.external_reference,
        task: {
          tenantId,
          caseId,
          type: "book_appointment"
        }
      },
      select: { id: true, externalReference: true }
    });
    if (
      !attempt ||
      attempt.externalReference !== completion.appointment.confirmation_reference
    ) {
      throw new CaseManagerError(
        "INVALID_EVIDENCE",
        "Successful attempt evidence is missing or inconsistent"
      );
    }

    const artifact = await this.prisma.artifact.findFirst({
      where: {
        tenantId,
        id: completion.artifact.artifact_id,
        caseId,
        type: "appointment_confirmation",
        verificationStatus: "verified",
        checksum: completion.artifact.checksum
      },
      select: { id: true }
    });
    if (!artifact) {
      throw new CaseManagerError(
        "INVALID_EVIDENCE",
        "Verified confirmation artifact is missing or inconsistent"
      );
    }

    const projections = await this.prisma.calendarProjection.findMany({
      where: { tenantId, caseId },
      select: {
        startsAt: true,
        syncStatus: true,
        externalEventId: true,
        failureCode: true
      }
    });
    if (projections.length !== 1) {
      throw new CaseManagerError(
        "INVALID_EVIDENCE",
        "Exactly one calendar projection is required"
      );
    }
    const projection = projections[0];
    const appointmentStartsAt = parseRfc3339DateTime(
      completion.appointment.starts_at
    );
    if (
      !projection ||
      !appointmentStartsAt ||
      projection.startsAt.getTime() !== appointmentStartsAt.getTime() ||
      projection.syncStatus !== completion.calendar.sync_status ||
      (completion.calendar.sync_status === "synced" &&
        projection.externalEventId !== completion.calendar.external_event_id) ||
      (completion.calendar.sync_status === "failed" &&
        projection.failureCode !== completion.calendar.failure_code)
    ) {
      throw new CaseManagerError(
        "INVALID_EVIDENCE",
        "Calendar projection evidence is inconsistent"
      );
    }
  }
}

function isCaseStatus(value: string): value is CaseStatus {
  return Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, value);
}

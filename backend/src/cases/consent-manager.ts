import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import type { ConsentDraft, DataCategory } from "../conversation/types.js";
import { parseRfc3339DateTime } from "./rfc3339.js";

const MEDICAL_SCOPE = "coordinate_medical_appointment";
const CONSENT_VERSION = "1.0.0";
const DATA_CATEGORIES = new Set<DataCategory>([
  "subject_identity",
  "coverage",
  "availability_preferences"
]);
const REQUIRED_EFFECT_CATEGORIES: readonly DataCategory[] = [
  "subject_identity",
  "availability_preferences"
];
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

type ConsentManagerPrisma = Pick<
  PrismaClient,
  "case" | "subject" | "delegation" | "consent" | "task"
>;

export interface ConsentManagerDependencies {
  clock: () => Date;
  consentId: (tenantId: string, decisionId: string) => string;
}

export interface DecideMedicalAppointmentConsentInput {
  tenantId: string;
  caseId: string;
  principalId: string;
  decisionId: string;
  decision: "approved" | "rejected";
  draft: ConsentDraft;
  version: string;
}

export interface RevokeConsentInput {
  tenantId: string;
  caseId: string;
  principalId: string;
  consentId: string;
}

export interface MedicalAppointmentEffect {
  tenantId: string;
  caseId: string;
  taskId: string;
  type: "search_appointment" | "book_appointment";
  subjectId: string;
  counterpartyId: string;
  consentId: string;
}

export type ConsentManagerErrorCode =
  | "NOT_FOUND"
  | "INVALID_DECISION"
  | "INVALID_PROPOSAL"
  | "DECISION_CONFLICT"
  | "NOT_AUTHORIZED"
  | "CONCURRENT_UPDATE";

export class ConsentManagerError extends Error {
  constructor(
    public readonly code: ConsentManagerErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ConsentManagerError";
  }
}

const defaultDependencies: ConsentManagerDependencies = {
  clock: () => new Date(),
  consentId: (tenantId, decisionId) =>
    `consent:${createHash("sha256")
      .update(tenantId)
      .update("\0")
      .update(decisionId)
      .digest("hex")
      .slice(0, 40)}`
};

/**
 * Deterministic authority boundary for medical-appointment disclosure.
 *
 * It intentionally owns active Consent creation. The generic case repository
 * exposes consent only through dossier reads, preventing callers from creating
 * authority without an explicit principal decision.
 */
export class ConsentManager {
  private readonly dependencies: ConsentManagerDependencies;

  constructor(
    private readonly prisma: ConsentManagerPrisma,
    dependencies: Partial<ConsentManagerDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async decideMedicalAppointmentConsent(
    input: DecideMedicalAppointmentConsentInput
  ) {
    const now = this.dependencies.clock();
    const proposal = validateProposal(input, now);
    const caseRecord = await this.findOwnedCase(
      input.tenantId,
      input.caseId,
      input.principalId
    );
    const consentId = this.dependencies.consentId(input.tenantId, input.decisionId);
    if (!VALID_ID.test(consentId)) {
      throw new ConsentManagerError(
        "INVALID_DECISION",
        "Derived consent identifier is invalid"
      );
    }
    const existing = await this.findConsent(input.tenantId, consentId);

    if (existing) {
      if (!matchesApproval(existing, input, proposal.expiresAt)) {
        throw new ConsentManagerError(
          "DECISION_CONFLICT",
          "Decision identifier is already associated with different consent"
        );
      }
      if (
        existing.status !== "active" ||
        existing.revokedAt ||
        existing.grantedAt > now ||
        !existing.expiresAt ||
        existing.expiresAt <= now
      ) {
        throw new ConsentManagerError(
          "NOT_AUTHORIZED",
          "Consent decision is no longer active; a new decision is required"
        );
      }
      return existing;
    }

    if (input.decision === "rejected") {
      return { decision: "rejected" as const, consent: null };
    }
    if (
      caseRecord.type !== "medical_appointment" ||
      caseRecord.status !== "ready_for_confirmation"
    ) {
      throw new ConsentManagerError(
        "NOT_AUTHORIZED",
        "Case is not ready for medical appointment consent"
      );
    }
    if (
      !caseRecord.counterpartyId ||
      caseRecord.counterpartyId !== input.draft.counterparty_id
    ) {
      throw new ConsentManagerError(
        "NOT_AUTHORIZED",
        "Consent recipient does not match the case recipient"
      );
    }

    await this.requireCurrentAuthority(
      input.tenantId,
      caseRecord.principalId,
      caseRecord.subjectId,
      now
    );

    try {
      return await this.prisma.consent.create({
        data: {
          id: consentId,
          tenantId: input.tenantId,
          caseId: input.caseId,
          scope: input.draft.purpose,
          dataCategories: [...input.draft.data_categories],
          counterpartyId: input.draft.counterparty_id,
          version: input.version,
          status: "active",
          grantedAt: now,
          expiresAt: proposal.expiresAt,
          createdAt: now,
          updatedAt: now
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrent = await this.findConsent(input.tenantId, consentId);
      if (
        concurrent &&
        matchesApproval(concurrent, input, proposal.expiresAt) &&
        concurrent.status === "active" &&
        !concurrent.revokedAt &&
        concurrent.grantedAt <= now &&
        concurrent.expiresAt &&
        concurrent.expiresAt > now
      ) {
        return concurrent;
      }
      throw new ConsentManagerError(
        "DECISION_CONFLICT",
        "Decision identifier could not be persisted idempotently"
      );
    }
  }

  async revokeConsent(input: RevokeConsentInput) {
    await this.findOwnedCase(input.tenantId, input.caseId, input.principalId);
    const existing = await this.prisma.consent.findFirst({
      where: {
        tenantId: input.tenantId,
        id: input.consentId,
        caseId: input.caseId
      }
    });
    if (!existing) throw notFound();
    if (existing.status === "revoked" && existing.revokedAt) return existing;

    const now = this.dependencies.clock();
    const result = await this.prisma.consent.updateMany({
      where: {
        tenantId: input.tenantId,
        id: input.consentId,
        caseId: input.caseId,
        status: existing.status,
        revokedAt: null
      },
      data: {
        status: "revoked",
        revokedAt: now,
        updatedAt: now
      }
    });
    if (result.count === 1) {
      return { ...existing, status: "revoked", revokedAt: now, updatedAt: now };
    }

    const concurrent = await this.prisma.consent.findFirst({
      where: {
        tenantId: input.tenantId,
        id: input.consentId,
        caseId: input.caseId
      }
    });
    if (concurrent?.status === "revoked" && concurrent.revokedAt) return concurrent;
    throw new ConsentManagerError(
      "CONCURRENT_UPDATE",
      "Consent changed while applying revocation"
    );
  }

  async authorizeMedicalAppointmentEffect(input: MedicalAppointmentEffect) {
    const now = this.dependencies.clock();
    const caseRecord = await this.prisma.case.findFirst({
      where: { tenantId: input.tenantId, id: input.caseId },
      select: {
        id: true,
        tenantId: true,
        principalId: true,
        subjectId: true,
        counterpartyId: true,
        type: true,
        status: true
      }
    });
    if (!caseRecord) throw notFound();
    if (
      caseRecord.type !== "medical_appointment" ||
      (caseRecord.status !== "executing" &&
        caseRecord.status !== "waiting_external") ||
      input.subjectId !== caseRecord.subjectId ||
      !caseRecord.counterpartyId ||
      input.counterpartyId !== caseRecord.counterpartyId
    ) {
      throw notAuthorized();
    }

    const task = await this.prisma.task.findFirst({
      where: {
        tenantId: input.tenantId,
        id: input.taskId,
        caseId: input.caseId,
        type: input.type
      },
      select: { id: true }
    });
    if (!task) throw notAuthorized();

    await this.requireCurrentAuthority(
      input.tenantId,
      caseRecord.principalId,
      caseRecord.subjectId,
      now
    );

    const consent = await this.prisma.consent.findFirst({
      where: {
        tenantId: input.tenantId,
        id: input.consentId,
        caseId: input.caseId
      }
    });
    if (!consent) throw notFound();
    const categories = jsonStringSet(consent.dataCategories);
    if (
      consent.scope !== MEDICAL_SCOPE ||
      consent.counterpartyId !== caseRecord.counterpartyId ||
      consent.counterpartyId !== input.counterpartyId ||
      consent.version !== CONSENT_VERSION ||
      consent.status !== "active" ||
      consent.revokedAt ||
      consent.grantedAt > now ||
      !consent.expiresAt ||
      consent.expiresAt <= now ||
      !categories ||
      [...categories].some(
        (category) => !DATA_CATEGORIES.has(category as DataCategory)
      ) ||
      !REQUIRED_EFFECT_CATEGORIES.every((category) => categories.has(category))
    ) {
      throw notAuthorized();
    }
    return consent;
  }

  private async findOwnedCase(
    tenantId: string,
    caseId: string,
    principalId: string
  ) {
    const caseRecord = await this.prisma.case.findFirst({
      where: { tenantId, id: caseId, principalId },
      select: {
        id: true,
        tenantId: true,
        principalId: true,
        subjectId: true,
        counterpartyId: true,
        type: true,
        status: true
      }
    });
    if (!caseRecord) throw notFound();
    return caseRecord;
  }

  private findConsent(tenantId: string, consentId: string) {
    return this.prisma.consent.findFirst({
      where: { tenantId, id: consentId }
    });
  }

  private async requireCurrentAuthority(
    tenantId: string,
    principalId: string,
    subjectId: string,
    now: Date
  ): Promise<void> {
    const subject = await this.prisma.subject.findFirst({
      where: { tenantId, id: subjectId, principalId },
      select: { relationshipVerifiedAt: true }
    });
    if (
      !subject?.relationshipVerifiedAt ||
      subject.relationshipVerifiedAt > now
    ) {
      throw notAuthorized();
    }

    const delegations = await this.prisma.delegation.findMany({
      where: {
        tenantId,
        principalId,
        subjectId,
        status: "active"
      },
      select: {
        scope: true,
        validFrom: true,
        validUntil: true
      }
    });
    const valid = delegations.some(
      (delegation) =>
        delegation.validFrom <= now &&
        (!delegation.validUntil || delegation.validUntil > now) &&
        jsonStringSet(delegation.scope)?.has(MEDICAL_SCOPE)
    );
    if (!valid) throw notAuthorized();
  }
}

function validateProposal(
  input: DecideMedicalAppointmentConsentInput,
  now: Date
): { expiresAt: Date } {
  if (!VALID_ID.test(input.decisionId)) {
    throw new ConsentManagerError("INVALID_DECISION", "Decision identifier is invalid");
  }
  if (input.decision !== "approved" && input.decision !== "rejected") {
    throw new ConsentManagerError("INVALID_DECISION", "Consent decision is invalid");
  }
  if (
    input.draft.purpose !== MEDICAL_SCOPE ||
    !VALID_ID.test(input.draft.counterparty_id) ||
    input.version !== CONSENT_VERSION
  ) {
    throw new ConsentManagerError("INVALID_PROPOSAL", "Consent proposal is invalid");
  }
  validateProposalCategories(input.draft.data_categories);
  const expiresAt = parseRfc3339DateTime(input.draft.expires_at);
  if (!expiresAt || expiresAt <= now) {
    throw new ConsentManagerError(
      "INVALID_PROPOSAL",
      "Consent expiration is invalid"
    );
  }
  return { expiresAt };
}

function validateProposalCategories(categories: readonly unknown[]): void {
  if (
    categories.length === 0 ||
    new Set(categories).size !== categories.length ||
    categories.some(
      (category): category is Exclude<unknown, DataCategory> =>
        typeof category !== "string" || !DATA_CATEGORIES.has(category as DataCategory)
    )
  ) {
    throw new ConsentManagerError(
      "INVALID_PROPOSAL",
      "Consent data categories are invalid"
    );
  }
}

function matchesApproval(
  consent: {
    caseId: string;
    scope: string;
    dataCategories: Prisma.JsonValue;
    counterpartyId: string | null;
    version: string;
    expiresAt: Date | null;
  },
  input: DecideMedicalAppointmentConsentInput,
  expiresAt: Date
): boolean {
  const persistedCategories = jsonStringSet(consent.dataCategories);
  const requestedCategories = new Set(input.draft.data_categories);
  return (
    input.decision === "approved" &&
    consent.caseId === input.caseId &&
    consent.scope === input.draft.purpose &&
    consent.counterpartyId === input.draft.counterparty_id &&
    consent.version === input.version &&
    consent.expiresAt?.getTime() === expiresAt.getTime() &&
    persistedCategories !== null &&
    setsEqual(persistedCategories, requestedCategories)
  );
}

function jsonStringSet(value: Prisma.JsonValue): Set<string> | null {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string") ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return new Set(value as string[]);
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function notFound(): ConsentManagerError {
  return new ConsentManagerError("NOT_FOUND", "Resource not found for tenant");
}

function notAuthorized(): ConsentManagerError {
  return new ConsentManagerError(
    "NOT_AUTHORIZED",
    "Medical appointment effect is not authorized"
  );
}

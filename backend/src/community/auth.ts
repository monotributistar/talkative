/**
 * Community Auth — MVP
 *
 * Two levels:
 *   1. Resident: needs a community code to submit reports (shared code per barrio)
 *   2. Operator: needs a password to access dashboard/admin
 *
 * Configured via environment variables:
 *   COMMUNITY_CODE    — Code residents use (e.g., "carilo2026")
 *   OPERATOR_PASSWORD  — Password for dashboard access
 *
 * This is NOT production auth. It's a shared secret to prevent
 * random internet access while keeping the MVP simple.
 *
 * Upgrade path: JWT tokens with per-user accounts.
 */

import { Request, Response, NextFunction } from "express";

const COMMUNITY_TENANT_ID = process.env.COMMUNITY_TENANT_ID?.trim() || "tenant-default";
const COMMUNITY_CODE = process.env.COMMUNITY_CODE?.trim();
const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD?.trim();

function getOperatorPasswordOrThrow(): string {
  if (!OPERATOR_PASSWORD) {
    throw new Error("OPERATOR_PASSWORD is required for community operator routes");
  }
  return OPERATOR_PASSWORD;
}

function getCommunityCodeMap(): Map<string, string> {
  const fromMap = process.env.COMMUNITY_CODE_MAP?.trim();
  if (fromMap) {
    const entries = fromMap
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [tenant, code] = pair.split(":").map((part) => part.trim());
        return [tenant, code] as const;
      })
      .filter(([tenant, code]) => Boolean(tenant) && Boolean(code));
    return new Map(entries);
  }

  if (COMMUNITY_CODE) {
    return new Map([[COMMUNITY_TENANT_ID, COMMUNITY_CODE]]);
  }

  throw new Error("COMMUNITY_CODE or COMMUNITY_CODE_MAP is required for community resident routes");
}

function resolveTenantForCode(code: string): string | null {
  const map = getCommunityCodeMap();
  for (const [tenant, candidateCode] of map.entries()) {
    if (candidateCode === code) return tenant;
  }
  return null;
}

/**
 * Validates the community code for resident-facing endpoints.
 * Accepts code via:
 *   - Header: x-community-code
 *   - Body: { community_code: "..." }
 *   - Query: ?code=...
 */
export function requireCommunityCode(req: Request, res: Response, next: NextFunction): void {
  const code =
    (req.headers["x-community-code"] as string) ||
    ((req.body as Record<string, unknown>)?.community_code as string) ||
    (req.query.code as string);

  const tenant_id = code ? resolveTenantForCode(code) : null;
  if (!code || !tenant_id) {
    res.status(401).json({ error: "Código de comunidad inválido" });
    return;
  }

  req.community_tenant_id = tenant_id;
  next();
}

/**
 * Validates operator password for admin/dashboard endpoints.
 * Accepts via:
 *   - Header: x-operator-token (the password itself for MVP)
 *   - Session cookie (future)
 *
 * Also provides a login endpoint to "validate" the password
 * and return a simple token (which is just the password hashed,
 * but enough for MVP).
 */
export function requireOperator(req: Request, res: Response, next: NextFunction): void {
  let expected: string;
  try {
    expected = getOperatorPasswordOrThrow();
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
    return;
  }

  const token =
    (req.headers["x-operator-token"] as string) ||
    (req.headers["authorization"] as string)?.replace("Bearer ", "");

  if (!token || token !== expected) {
    res.status(401).json({ error: "Acceso no autorizado" });
    return;
  }

  // Security: bind operator to configured tenant — ignore x-tenant-id header.
  // This prevents tenant spoofing (P0 finding from PR #35 review).
  // Future: derive tenant from JWT token for multi-tenant support.
  const tenantId = COMMUNITY_TENANT_ID;
  req.community_tenant_id = tenantId;
  if (!req.context) (req as any).context = {};
  (req as any).context.tenant_id = tenantId;

  next();
}

/**
 * Login endpoint handler — validates password and returns token.
 * POST /community/auth/login
 * Body: { password: "..." }
 * Returns: { ok: true, token: "..." } or 401
 */
export function handleLogin(req: Request, res: Response): void {
  let expected: string;
  try {
    expected = getOperatorPasswordOrThrow();
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
    return;
  }

  const { password } = req.body as { password?: string };

  if (!password) {
    res.status(400).json({ error: "Password required" });
    return;
  }

  if (password === expected) {
    // For MVP the token IS the password — the middleware checks the same value
    // In production this would be a JWT
    res.json({ ok: true, token: expected, message: "Acceso autorizado" });
    return;
  }

  res.status(401).json({ error: "Contraseña incorrecta" });
}

/**
 * Validate community code endpoint — for resident app to check before showing form.
 * POST /community/auth/validate-code
 * Body: { code: "..." }
 */
export function handleValidateCode(req: Request, res: Response): void {
  const { code } = req.body as { code?: string };

  if (!code) {
    res.status(400).json({ error: "Code required" });
    return;
  }

  const tenant_id = code ? resolveTenantForCode(code) : null;
  if (tenant_id) {
    res.json({ ok: true, tenant_id, message: "Código válido" });
    return;
  }

  res.status(401).json({ error: "Código inválido" });
}

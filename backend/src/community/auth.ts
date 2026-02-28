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

const COMMUNITY_CODE = process.env.COMMUNITY_CODE || "carilo2026";
const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD || "seguridad2026";

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
    (req.body as Record<string, unknown>)?.community_code as string ||
    (req.query.code as string);

  if (!code || code !== COMMUNITY_CODE) {
    res.status(401).json({ error: "Código de comunidad inválido" });
    return;
  }

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
  const token =
    (req.headers["x-operator-token"] as string) ||
    (req.headers["authorization"] as string)?.replace("Bearer ", "");

  if (!token || token !== OPERATOR_PASSWORD) {
    res.status(401).json({ error: "Acceso no autorizado" });
    return;
  }

  next();
}

/**
 * Login endpoint handler — validates password and returns token.
 * POST /community/auth/login
 * Body: { password: "..." }
 * Returns: { ok: true, token: "..." } or 401
 */
export function handleLogin(req: Request, res: Response): void {
  const { password } = req.body as { password?: string };

  if (!password) {
    res.status(400).json({ error: "Password required" });
    return;
  }

  if (password === OPERATOR_PASSWORD) {
    // For MVP the token IS the password — the middleware checks the same value
    // In production this would be a JWT
    res.json({ ok: true, token: OPERATOR_PASSWORD, message: "Acceso autorizado" });
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

  if (code === COMMUNITY_CODE) {
    res.json({ ok: true, message: "Código válido" });
    return;
  }

  res.status(401).json({ error: "Código inválido" });
}

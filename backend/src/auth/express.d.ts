import type { AuthPrincipal } from "./types.js";
import type { LogContext } from "../observability/logger.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPrincipal;
      context?: Required<LogContext> & { request_id: string };
      community_tenant_id?: string;
    }
  }
}

export {};

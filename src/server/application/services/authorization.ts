import type { Principal } from "../ports/identity";

export class AuthenticationError extends Error {
  readonly status = 401;
  constructor() { super("Sign in to continue."); }
}
export class AuthorizationError extends Error {
  readonly status = 403;
  constructor() { super("This action is not permitted."); }
}

export type Permission = "read" | "operate" | "administer";

/** Organization roles are the baseline; scoped agent/skill grants follow in Phase 3. */
export function authorize(principal: Principal, permission: Permission) {
  if (permission === "administer" && principal.role !== "admin") throw new AuthorizationError();
  if (permission === "operate" && !["admin", "operator"].includes(principal.role)) throw new AuthorizationError();
  if (!["admin", "operator", "viewer"].includes(principal.role)) throw new AuthorizationError();
}

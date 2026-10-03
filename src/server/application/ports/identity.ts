export type OrganizationRole = "admin" | "operator" | "viewer";

/** Plane A identity. No provider tokens, client headers or remote tenant claims. */
export interface Principal {
  userId: string;
  organizationId: string;
  membershipId: string;
  displayName: string;
  role: OrganizationRole;
}

export interface IdentityRepository {
  resolveExternal(issuer: string, subject: string, organizationSlug: string): Promise<Principal | undefined>;
  resolveSession(tokenHash: string, now: Date): Promise<Principal | undefined>;
  createSession(tokenHash: string, principal: Principal, expiresAt: Date): Promise<void>;
  revokeSession(tokenHash: string): Promise<void>;
  saveLogin(tokenHash: string, encryptedFlow: string, expiresAt: Date): Promise<void>;
  consumeLogin(tokenHash: string, now: Date): Promise<string | undefined>;
  appendAudit(principal: Principal, action: string, targetId: string, eventKey?: string): Promise<void>;
}

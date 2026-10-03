import type { Principal } from "./identity";

export type AgentPermission = "read" | "operate";
export interface AccessGrant {
  id: string; organizationId: string; subjectType: "organization" | "membership" | "team";
  subjectId: string; agentId: string; skillId: string | null; permission: AgentPermission; enabled: boolean;
}
export interface AccessPolicyRepository {
  grantsFor(principal: Principal): Promise<AccessGrant[]>;
}
export type ServiceCredential =
  | { type: "apiKey"; name: string; value: string }
  | { type: "bearer"; token: string }
  | { type: "oauthClient"; issuer: string; tokenEndpoint: string; clientId: string; clientSecret: string; scope?: string }
  | { type: "mtls"; cert: string; key: string; ca?: string };
export interface CredentialBinding { origins: string[]; credential: ServiceCredential }
export interface CredentialVault {
  resolve(organizationId: string, agentId: string): Promise<CredentialBinding | undefined>;
  store(organizationId: string, agentId: string, binding: CredentialBinding): Promise<void>;
  revoke(organizationId: string, agentId: string): Promise<void>;
}

import { randomUUID } from "node:crypto";
import { CompactEncrypt, compactDecrypt } from "jose";
import type { EntityManager } from "@mikro-orm/core";
import type { CredentialBinding, CredentialVault } from "../../application/ports/security";
import { credentialBindingSchema } from "../auth/credential-schema";
import { AgentCredentialEntity, AgentEntity } from "./entities";
import { DatabaseIdentityRepository } from "./identity-repository";

function keyRing() {
  const raw = JSON.parse(process.env.A2A_VAULT_KEYS ?? "{}") as Record<string, string>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Object.keys(raw).length ||
    Object.entries(raw).some(([id, key]) => !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !/^[0-9a-f]{64}$/i.test(key))) throw new Error("Credential vault unavailable.");
  const active = process.env.A2A_VAULT_ACTIVE_KEY;
  if (!active || !raw[active]) throw new Error("Credential vault unavailable.");
  return { keys: raw, active };
}
export class EncryptedDatabaseCredentialVault implements CredentialVault {
  constructor(private readonly em: EntityManager) {}
  async resolve(organizationId: string, agentId: string): Promise<CredentialBinding | undefined> {
    const row = await this.em.findOne(AgentCredentialEntity, { organizationId, agentId });
    if (!row) return;
    // Disabled bindings fail closed; they never silently downgrade to anonymous.
    if (!row.enabled) throw new Error("Agent credentials are disabled.");
    try {
      const ring = keyRing();
      if (!ring.keys[row.keyId]) throw new Error();
      const { plaintext, protectedHeader } = await compactDecrypt(row.ciphertext, Buffer.from(ring.keys[row.keyId], "hex"),
        { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
      if (protectedHeader.kid !== row.keyId || protectedHeader.typ !== "a2a-agent-credential") throw new Error();
      const payload = JSON.parse(new TextDecoder().decode(plaintext));
      if (payload.organizationId !== organizationId || payload.agentId !== agentId) throw new Error();
      return credentialBindingSchema.parse(payload.binding);
    } catch { throw new Error("Credential vault unavailable."); }
  }
  async store(organizationId: string, agentId: string, binding: CredentialBinding) {
    const validated = credentialBindingSchema.parse(binding);
    if (!await this.em.findOne(AgentEntity, {id: agentId, organizationId, enabled: true})) throw new Error("Unknown agent.");
    const ring = keyRing();
    const ciphertext = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify({organizationId, agentId, binding: validated})))
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", kid: ring.active, typ: "a2a-agent-credential" })
      .encrypt(Buffer.from(ring.keys[ring.active], "hex"));
    await this.em.transactional(async (tx) => {
      await tx.upsert(AgentCredentialEntity, {id: randomUUID(), organizationId, agentId, kind: validated.credential.type,
        ciphertext, keyId: ring.active, enabled: true, updatedAt: new Date() },
        {onConflictFields: ["organizationId", "agentId"], onConflictMergeFields: ["kind", "ciphertext", "keyId", "enabled", "updatedAt"]});
      await new DatabaseIdentityRepository(tx).appendSystemAudit(organizationId, "credential.rotated", agentId);
    });
  }
  async revoke(organizationId: string, agentId: string) {
    await this.em.transactional(async (tx) => {
      await tx.nativeUpdate(AgentCredentialEntity, {organizationId, agentId}, {enabled: false, updatedAt: new Date()});
      await new DatabaseIdentityRepository(tx).appendSystemAudit(organizationId, "credential.revoked", agentId);
    });
  }
}

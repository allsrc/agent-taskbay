import type { CredentialBinding } from "../../application/ports/security";
import * as oauth from "openid-client";
import type { ConnectionConfig } from "../../../lib/types";
import { createSafeFetch } from "../../../lib/safe-fetch";
import { EncryptedDatabaseCredentialVault } from "../db/credential-vault";
import { withJobEntityManager } from "../db/orm";

/** Credentials never enter a command, protocol params, browser connection or wire view. */
export async function agentConnection(agent: {id: string; organizationId: string; cardUrl: string}): Promise<ConnectionConfig> {
  const binding = await withJobEntityManager((em) => new EncryptedDatabaseCredentialVault(em).resolve(agent.organizationId, agent.id));
  return connectionForBinding(agent.cardUrl, binding);
}

export async function connectionForBinding(cardUrl: string, binding?: CredentialBinding): Promise<ConnectionConfig> {
  if (!binding) return {cardUrl, auth: {type: "none"}, headers: {}};
  const base: ConnectionConfig = {cardUrl, auth: {type: "none"}, headers: {},
    credentialOrigins: binding.origins.map((origin) => new URL(origin).origin), secretValues: []};
  const credential = binding.credential;
  if (credential.type === "apiKey") return {...base, auth: credential, secretValues: [credential.value]};
  if (credential.type === "bearer") return {...base, auth: credential, secretValues: [credential.token]};
  if (credential.type === "mtls") return {...base, tls: credential, secretValues: [credential.key, credential.cert]};
  try {
    const config = new oauth.Configuration({issuer: credential.issuer, token_endpoint: credential.tokenEndpoint},
      credential.clientId, {client_secret: credential.clientSecret}, oauth.ClientSecretPost(credential.clientSecret));
    const fetchImpl = createSafeFetch({auth: {type: "none"}, headers: {}, telemetry: [], timeoutMs: 15_000,
      credentialOrigins: [new URL(credential.tokenEndpoint).origin]});
    config[oauth.customFetch] = (url, options) => fetchImpl(url, options as RequestInit);
    const tokens = await oauth.clientCredentialsGrant(config, credential.scope ? {scope: credential.scope} : undefined);
    if (tokens.token_type.toLowerCase() !== "bearer" || !tokens.access_token || tokens.access_token.length < 8) throw new Error();
    return {...base, auth: {type: "bearer", token: tokens.access_token}, secretValues: [credential.clientSecret, tokens.access_token]};
  } catch { throw new Error("Agent OAuth credentials unavailable."); }
}

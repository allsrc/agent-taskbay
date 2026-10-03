import * as oidc from "openid-client";
import { CompactEncrypt, compactDecrypt } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { AuthConfig } from "./config";

type Config = Extract<AuthConfig, { mode: "oidc" }>;
export interface LoginFlow { state: string; nonce: string; verifier: string; returnTo: string }
export const opaqueToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

export function safeReturnTo(value?: string | null) {
  // Restrict navigation to a relative app path; also reject encoded slash/backslash tricks.
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]|%2f|%5c|%0[ad]/i.test(value)) return "/tasks";
  return value.slice(0, 2048);
}

/** Only encrypted nonce/PKCE material enters the database. The cookie is opaque. */
export function sealFlow(flow: LoginFlow, key: Buffer) {
  return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(flow)))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "a2a-ops:oidc-flow:v1" }).encrypt(key);
}
export async function openFlow(value: string, key: Buffer): Promise<LoginFlow> {
  const { plaintext, protectedHeader } = await compactDecrypt(value, key, {
    keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"],
  });
  if (protectedHeader.typ !== "a2a-ops:oidc-flow:v1") throw new Error("Invalid login flow.");
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export class OidcIdentityAdapter {
  private discovery?: Promise<oidc.Configuration>;
  constructor(private readonly config: Config, private readonly fetcher?: oidc.CustomFetch) {}
  private client() {
    if (!this.discovery) {
      this.discovery = oidc.discovery(new URL(this.config.issuer), this.config.clientId,
        { client_secret: this.config.clientSecret, id_token_signed_response_alg: "RS256" },
        oidc.ClientSecretPost(this.config.clientSecret), {
          execute: [oidc.enableNonRepudiationChecks], timeout: 10,
          ...(this.fetcher ? { [oidc.customFetch]: this.fetcher } : {}),
        }).catch((error) => { this.discovery = undefined; throw error; });
    }
    return this.discovery;
  }
  async begin(returnTo?: string | null) {
    const client = await this.client();
    const flow: LoginFlow = { state: oidc.randomState(), nonce: oidc.randomNonce(),
      verifier: oidc.randomPKCECodeVerifier(), returnTo: safeReturnTo(returnTo) };
    const url = oidc.buildAuthorizationUrl(client, { response_type: "code", scope: "openid profile",
      redirect_uri: `${this.config.origin}/api/auth/callback`, state: flow.state, nonce: flow.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier), code_challenge_method: "S256" });
    return { flow, url };
  }
  async complete(url: URL, flow: LoginFlow) {
    // Canonical configured origin; Host/Forwarded headers never select the redirect URI.
    const callback = new URL("/api/auth/callback", this.config.origin);
    callback.search = url.search;
    const tokens = await oidc.authorizationCodeGrant(await this.client(), callback, {
      expectedState: flow.state, expectedNonce: flow.nonce, pkceCodeVerifier: flow.verifier, idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub || typeof claims.sub !== "string" || claims.sub.length > 255) throw new Error("Invalid identity.");
    // Discard all tokens. Provider roles, organization, email and tenant are not authority.
    return { issuer: this.config.issuer, subject: claims.sub };
  }
}

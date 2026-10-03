export class AuthenticationConfigurationError extends Error {
  readonly status = 503;
  constructor() { super("Authentication is not configured correctly."); }
}

export type AuthConfig = { mode: "development" } | {
  mode: "oidc"; issuer: string; clientId: string; clientSecret: string;
  origin: string; organizationSlug: string; flowKey: Buffer; sessionSeconds: number;
};

function httpsUrl(value?: string, originOnly = false) {
  if (!value) throw new AuthenticationConfigurationError();
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    (originOnly && url.pathname !== "/")) throw new AuthenticationConfigurationError();
  return originOnly ? url.origin : url.href.replace(/\/$/, "");
}

export function loadAuthConfig(env: Readonly<Record<string, string | undefined>> = process.env): AuthConfig {
  try {
    const mode = env.A2A_AUTH_MODE || (env.NODE_ENV === "production" ? "oidc" : "development");
    if (mode === "development") {
      if (env.NODE_ENV === "production" && env.A2A_ALLOW_DEVELOPMENT_AUTH !== "true") throw new AuthenticationConfigurationError();
      return { mode };
    }
    if (mode !== "oidc" || !env.A2A_OIDC_CLIENT_ID || !env.A2A_OIDC_CLIENT_SECRET ||
      !env.A2A_AUTH_ORGANIZATION_SLUG || !/^[0-9a-f]{64}$/i.test(env.A2A_AUTH_FLOW_KEY ?? "")) throw new AuthenticationConfigurationError();
    const sessionSeconds = Number(env.A2A_AUTH_SESSION_SECONDS || 28800);
    if (!Number.isInteger(sessionSeconds) || sessionSeconds < 60 || sessionSeconds > 86400) throw new AuthenticationConfigurationError();
    return { mode, issuer: httpsUrl(env.A2A_OIDC_ISSUER), origin: httpsUrl(env.A2A_AUTH_ORIGIN, true),
      clientId: env.A2A_OIDC_CLIENT_ID, clientSecret: env.A2A_OIDC_CLIENT_SECRET,
      organizationSlug: env.A2A_AUTH_ORGANIZATION_SLUG, flowKey: Buffer.from(env.A2A_AUTH_FLOW_KEY!, "hex"), sessionSeconds };
  } catch { throw new AuthenticationConfigurationError(); }
}

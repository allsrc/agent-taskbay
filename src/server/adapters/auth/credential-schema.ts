import { z } from "zod";

const secret = z.string().min(8).max(100_000);
const httpsUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
}, "Credential endpoints require HTTPS without URL credentials.");
export const credentialBindingSchema = z.object({
  origins: z.array(httpsUrl.refine((value) => new URL(value).pathname === "/", "Use an exact credential origin.")).min(1).max(20),
  credential: z.discriminatedUnion("type", [
    z.object({type: z.literal("apiKey"), name: z.string().regex(/^[a-zA-Z0-9-]+$/).refine((value) =>
      !/^(host|cookie|set-cookie|connection|content-length|content-type|transfer-encoding|proxy-authorization)$/i.test(value)), value: secret}).strict(),
    z.object({type: z.literal("bearer"), token: secret}).strict(),
    z.object({type: z.literal("oauthClient"), issuer: httpsUrl, tokenEndpoint: httpsUrl,
      clientId: z.string().min(1).max(255), clientSecret: secret, scope: z.string().max(1000).optional()}).strict(),
    z.object({type: z.literal("mtls"), cert: secret, key: secret, ca: secret.optional()}).strict(),
  ]),
}).strict();

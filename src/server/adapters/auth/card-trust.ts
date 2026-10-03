import { AgentCard, canonicalizeAgentCard } from "@a2a-js/sdk";
import { flattenedVerify, importJWK, type JWK } from "jose";

export type CardTrust = "unsigned" | "verified" | "untrusted" | "invalid";
export async function verifyCardTrust(card: AgentCard, origin: string): Promise<CardTrust> {
  if (!card.signatures?.length) return "unsigned";
  try {
    const trusted = JSON.parse(process.env.A2A_TRUSTED_CARD_KEYS ?? "[]") as Array<{
      origin: string; kid: string; jwk: JWK; expiresAt: string;
    }>;
    let known = false;
    const payload = Buffer.from(canonicalizeAgentCard(card)).toString("base64url");
    for (const signature of card.signatures) {
      try {
        const header = JSON.parse(Buffer.from(signature.protected, "base64url").toString("utf8"));
        if (!["RS256", "ES256", "EdDSA"].includes(header.alg) || typeof header.kid !== "string" || header.crit || header.b64 === false) continue;
        // Never fetch a key URL advertised by an untrusted card. Expired keys are revoked.
        const key = trusted.find((entry) => entry.origin === origin && entry.kid === header.kid && Date.parse(entry.expiresAt) > Date.now());
        if (!key || key.jwk.d || key.jwk.k || !["RSA", "EC", "OKP"].includes(key.jwk.kty ?? "") || key.jwk.alg !== header.alg) continue;
        known = true;
        const publicKey = await importJWK(key.jwk, header.alg);
        if (publicKey instanceof Uint8Array) continue;
        // SDK canonicalization plus jose verification avoids SDK logging untrusted signature/error objects.
        await flattenedVerify({protected: signature.protected, signature: signature.signature, payload}, publicKey,
          {algorithms: [header.alg]});
        return "verified";
      } catch { /* Try another independently trusted signature without logging remote input. */ }
    }
    return known ? "invalid" : "untrusted";
  } catch { return "invalid"; }
}

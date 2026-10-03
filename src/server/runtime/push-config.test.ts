import { describe, expect, it } from "vitest";
import { loadPushCredentials } from "./push-config";
import type { PushRegistrationRecord } from "../domain/persistence-model";

const environment = { A2A_PUSH_CALLBACK_ORIGIN: "https://console.example.test", A2A_PUSH_SIGNING_KEY: "ab".repeat(32) };
const registration = { id: "registration-one", organizationId: "org-one" } as PushRegistrationRecord;
describe("SEC-003 SEC-005 per-registration push credentials", () => {
  it("derives stable scoped tokens and rejects missing, wrong or rotated credentials", () => {
    const credentials = loadPushCredentials(environment)!;
    const token = credentials.token(registration);
    expect(credentials.token(registration)).toBe(token);
    expect(credentials.authenticate(registration, `bEaReR ${token}`)).toBe(true);
    for (const header of [null, "Basic token", "Bearer short", `Bearer ${"z".repeat(43)}`]) expect(credentials.authenticate(registration, header)).toBe(false);
    expect(credentials.authenticate({ ...registration, organizationId: "other" }, `Bearer ${token}`)).toBe(false);
    expect(credentials.authenticate({ ...registration, id: "other" }, `Bearer ${token}`)).toBe(false);
    expect(loadPushCredentials({ ...environment, A2A_PUSH_SIGNING_KEY: "cd".repeat(32) })!.authenticate(registration, `Bearer ${token}`)).toBe(false);
    expect(credentials.callbackUrl(registration)).toBe("https://console.example.test/api/webhooks/a2a/registration-one");
  });
  it("fails closed on invalid configuration without exposing supplied secrets", () => {
    expect(loadPushCredentials({})).toBeUndefined();
    expect(() => loadPushCredentials({ ...environment, A2A_PUSH_SIGNING_KEY: "secret-do-not-echo" })).toThrow("64 hexadecimal");
    for (const origin of ["http://public.example.test", "https://user:password@example.test", "https://example.test/path", "https://example.test?query", "ftp://example.test", "invalid"]) {
      expect(() => loadPushCredentials({ ...environment, A2A_PUSH_CALLBACK_ORIGIN: origin })).toThrow();
    }
    expect(() => loadPushCredentials({ ...environment, A2A_PUSH_CALLBACK_ORIGIN: "http://127.0.0.1:3103" })).toThrow();
    expect(loadPushCredentials({ ...environment, A2A_PUSH_CALLBACK_ORIGIN: "http://127.0.0.1:3103", A2A_PUSH_ALLOW_LOOPBACK_HTTP: "true" })).toBeDefined();
  });
});

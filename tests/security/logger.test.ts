import { logSafeEvent, serializeSafeLog } from "@/security/logger";
import { afterEach, describe, expect, it, vi } from "vitest";

const CANARY_VALUES = [
  "pii-canary@example.test",
  "483920",
  "Bearer pii-canary-token",
  "session=pii-canary-cookie",
  "https://example.test/profile?email=pii-canary%40example.test",
  "postgres://pii-canary:secret@example.test/private",
  "q83vM8zT+piiCanaryCiphertext==",
  '{"email":"pii-canary@example.test"}',
] as const;

const DELIVERY_CANARY_VALUES = [
  "delivery-canary@example.test",
  "739204",
  "Your verification code is 739204",
  "delivery-ciphertext-q83vM8zT+piiCanary==",
  "provider-api-key-pii-canary",
  '{"provider_message_id":"pii-canary-message","status":"accepted"}',
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("privacy-safe logging", () => {
  it("serializes only validated, bounded telemetry values", () => {
    const output = serializeSafeLog({
      event: "IDENTIFIER_STORED",
      environment: "preview",
      serviceVersion: "0.1.0",
      requestId: "req_1234567890abcdef",
      correlationId: "corr_1234567890abcdef",
      userId: "user_1234567890abcdef",
      identityId: "identity_1234567890abcdef",
      identifierId: "identifier_1234567890abcdef",
      targetId: "target_1234567890abcdef",
      outcome: "success",
      errorCode: "rate_limited",
      durationBucket: "100_499ms",
    });

    expect(JSON.parse(output)).toEqual({
      event: "IDENTIFIER_STORED",
      environment: "preview",
      serviceVersion: "0.1.0",
      requestId: "req_1234567890abcdef",
      correlationId: "corr_1234567890abcdef",
      userId: "user_1234567890abcdef",
      identityId: "identity_1234567890abcdef",
      identifierId: "identifier_1234567890abcdef",
      targetId: "target_1234567890abcdef",
      outcome: "success",
      errorCode: "rate_limited",
      durationBucket: "100_499ms",
    });
  });

  it("drops every synthetic PII canary from allowed and unknown fields", () => {
    const output = serializeSafeLog({
      event: "CANARY_ATTEMPTED",
      environment: CANARY_VALUES[0],
      serviceVersion: CANARY_VALUES[1],
      requestId: CANARY_VALUES[2],
      correlationId: CANARY_VALUES[3],
      userId: CANARY_VALUES[4],
      identityId: CANARY_VALUES[5],
      identifierId: CANARY_VALUES[6],
      targetId: CANARY_VALUES[7],
      outcome: CANARY_VALUES[0],
      errorCode: CANARY_VALUES[2],
      durationBucket: CANARY_VALUES[6],
      query: CANARY_VALUES[0],
      requestBody: { email: CANARY_VALUES[0] },
    });

    expect(JSON.parse(output)).toEqual({ event: "CANARY_ATTEMPTED", redacted: true });
    for (const canary of CANARY_VALUES) expect(output).not.toContain(canary);
    expect(output).not.toContain("requestBody");
    expect(output).not.toContain("query");
  });

  it("drops every verification-delivery value class from allowed and unknown fields", () => {
    const output = serializeSafeLog({
      event: "DELIVERY_CANARY_ATTEMPTED",
      environment: DELIVERY_CANARY_VALUES[0],
      serviceVersion: DELIVERY_CANARY_VALUES[1],
      requestId: DELIVERY_CANARY_VALUES[2],
      correlationId: DELIVERY_CANARY_VALUES[3],
      outcome: DELIVERY_CANARY_VALUES[4],
      errorCode: DELIVERY_CANARY_VALUES[5],
      destination: DELIVERY_CANARY_VALUES[0],
      code: DELIVERY_CANARY_VALUES[1],
      content: DELIVERY_CANARY_VALUES[2],
      ciphertext: DELIVERY_CANARY_VALUES[3],
      providerCredential: DELIVERY_CANARY_VALUES[4],
      providerResponse: DELIVERY_CANARY_VALUES[5],
    });

    expect(JSON.parse(output)).toEqual({ event: "DELIVERY_CANARY_ATTEMPTED", redacted: true });
    for (const canary of DELIVERY_CANARY_VALUES) expect(output).not.toContain(canary);
    for (const field of [
      "destination",
      "code",
      "content",
      "ciphertext",
      "providerCredential",
      "providerResponse",
    ]) {
      expect(output).not.toContain(field);
    }
  });

  it("replaces an invalid event and blocks log injection", () => {
    const output = serializeSafeLog({
      event: 'SAFE_EVENT\n{"event":"FORGED_EVENT"}',
      requestId: "req_1234567890abcdef",
    });

    expect(JSON.parse(output)).toEqual({
      requestId: "req_1234567890abcdef",
      event: "TELEMETRY_REDACTED",
      redacted: true,
    });
    expect(output).not.toContain("FORGED_EVENT");
    expect(output).not.toContain("\n");
  });

  it("writes one structured string to the Worker-compatible console sink", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logSafeEvent({ event: "ACCOUNT_INITIALIZED", userId: "user_1234567890abcdef" });

    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({ event: "ACCOUNT_INITIALIZED", userId: "user_1234567890abcdef" }),
    );
  });
});

import { createKeyring } from "@/security/crypto";
import { LocalFakeEmailVerificationGateway } from "@/verification/email-verification-gateway";
import { describe, expect, it } from "vitest";

const keyring = createKeyring({
  keyId: "verification-gateway-v1",
  encryptionKeyBase64: Buffer.alloc(32, 79).toString("base64"),
  lookupKeyBase64: Buffer.alloc(32, 83).toString("base64"),
});

describe("local email verification gateway", () => {
  it("returns a purpose-bound hash and deterministic fifteen-minute expiry without delivery", async () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    const gateway = new LocalFakeEmailVerificationGateway(
      { appEnv: "local", authMode: "local", code: "123456" },
      keyring,
      () => now,
    );

    const first = await gateway.issueEmailChallenge({
      verificationId: "00000000-0000-4000-8000-000000000001",
      destination: "synthetic@example.test",
    });
    const second = await gateway.issueEmailChallenge({
      verificationId: "00000000-0000-4000-8000-000000000002",
      destination: "synthetic@example.test",
    });

    expect(first.method).toBe("LOCAL_FAKE_CODE");
    expect(first.challengeHash).not.toBe("123456");
    expect(first.challengeHash).not.toBe(second.challengeHash);
    expect(first.expiresAt).toEqual(new Date("2026-08-11T12:15:00.000Z"));
  });

  it("cannot operate outside local authentication and environment mode", async () => {
    const previewGateway = new LocalFakeEmailVerificationGateway(
      { appEnv: "preview", authMode: "local", code: "123456" },
      keyring,
    );
    const clerkGateway = new LocalFakeEmailVerificationGateway(
      { appEnv: "local", authMode: "clerk", code: "123456" },
      keyring,
    );
    const input = {
      verificationId: "00000000-0000-4000-8000-000000000001",
      destination: "synthetic@example.test",
    };

    await expect(previewGateway.issueEmailChallenge(input)).rejects.toThrow(
      "EMAIL_VERIFICATION_PROVIDER_NOT_CONFIGURED",
    );
    await expect(clerkGateway.issueEmailChallenge(input)).rejects.toThrow(
      "EMAIL_VERIFICATION_PROVIDER_NOT_CONFIGURED",
    );
  });
});

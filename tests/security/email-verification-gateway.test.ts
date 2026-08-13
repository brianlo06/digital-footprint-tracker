import { createDeliveryKeyring, createKeyring } from "@/security/crypto";
import {
  decryptDeliveryCommand,
  deliveryEncryptionContext,
} from "@/verification/delivery-envelope";
import {
  LocalFakeEmailVerificationGateway,
  OutboxEmailVerificationGateway,
} from "@/verification/email-verification-gateway";
import { describe, expect, it } from "vitest";

const keyring = createKeyring({
  keyId: "verification-gateway-v1",
  encryptionKeyBase64: Buffer.alloc(32, 79).toString("base64"),
  lookupKeyBase64: Buffer.alloc(32, 83).toString("base64"),
});

const deliveryKeyring = createDeliveryKeyring({
  keyId: "verification-gateway-delivery-v1",
  encryptionKeyBase64: Buffer.alloc(32, 89).toString("base64"),
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

describe("outbox email verification gateway", () => {
  it("populates a delivery descriptor whose payload round-trips under its own context", async () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    const gateway = new OutboxEmailVerificationGateway(
      { appEnv: "local", authMode: "local" },
      keyring,
      deliveryKeyring,
      () => now,
    );

    const challenge = await gateway.issueEmailChallenge({
      verificationId: "00000000-0000-4000-8000-000000000003",
      destination: "outbox@example.test",
    });

    expect(challenge.method).toBe("EMAIL_OUTBOX_CODE");
    expect(challenge.expiresAt).toEqual(new Date("2026-08-11T12:15:00.000Z"));
    expect(challenge.delivery).toBeDefined();
    const delivery = challenge.delivery!;
    expect(delivery.channel).toBe("EMAIL");
    expect(delivery.template).toBe("EMAIL_VERIFICATION_CODE_V1");
    expect(JSON.stringify(delivery.encryptedPayload)).not.toContain("outbox@example.test");

    const context = deliveryEncryptionContext({
      deliveryId: delivery.deliveryId,
      verificationId: "00000000-0000-4000-8000-000000000003",
      channel: delivery.channel,
      template: delivery.template,
    });
    const decrypted = decryptDeliveryCommand(delivery.encryptedPayload, context, deliveryKeyring);
    expect(decrypted.destination).toBe("outbox@example.test");
    expect(decrypted.code).toMatch(/^\d{6}$/);
    expect(challenge.challengeHash).not.toBe(decrypted.code);
  });

  it("generates fresh delivery IDs and codes across challenges", async () => {
    const gateway = new OutboxEmailVerificationGateway(
      { appEnv: "local", authMode: "local" },
      keyring,
      deliveryKeyring,
    );
    const input = {
      verificationId: "00000000-0000-4000-8000-000000000004",
      destination: "outbox@example.test",
    };

    const first = await gateway.issueEmailChallenge(input);
    const second = await gateway.issueEmailChallenge(input);

    expect(first.delivery!.deliveryId).not.toBe(second.delivery!.deliveryId);
    expect(first.challengeHash).not.toBe(second.challengeHash);
  });

  it("cannot operate outside local authentication and environment mode", async () => {
    const previewGateway = new OutboxEmailVerificationGateway(
      { appEnv: "preview", authMode: "local" },
      keyring,
      deliveryKeyring,
    );
    const clerkGateway = new OutboxEmailVerificationGateway(
      { appEnv: "local", authMode: "clerk" },
      keyring,
      deliveryKeyring,
    );
    const input = {
      verificationId: "00000000-0000-4000-8000-000000000005",
      destination: "outbox@example.test",
    };

    await expect(previewGateway.issueEmailChallenge(input)).rejects.toThrow(
      "EMAIL_VERIFICATION_PROVIDER_NOT_CONFIGURED",
    );
    await expect(clerkGateway.issueEmailChallenge(input)).rejects.toThrow(
      "EMAIL_VERIFICATION_PROVIDER_NOT_CONFIGURED",
    );
  });
});

import { createDeliveryKeyring, encryptSensitiveValue } from "@/security/crypto";
import type {
  ReportVerificationDeliveryFailureOptions,
  ClaimedVerificationDelivery,
} from "@/verification/delivery-outbox-core";
import {
  deliveryEncryptionContext,
  encryptDeliveryCommand,
} from "@/verification/delivery-envelope";
import type { DeliveryOutcome, DeliveryProvider } from "@/verification/delivery-provider";
import {
  deliveryClaimsEnabled,
  processClaimedVerificationDelivery,
  type VerificationDeliveryPersistence,
} from "@/verification/delivery-worker-core";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const keyring = createDeliveryKeyring({
  keyId: "delivery-worker-test-v1",
  encryptionKeyBase64: Buffer.alloc(32, 89).toString("base64"),
});
const now = new Date("2026-08-15T20:00:00.000Z");
const command = { destination: "worker.fixture@example.test", code: "739204" };

function claimedDelivery(): ClaimedVerificationDelivery {
  const deliveryId = randomUUID();
  const verificationId = randomUUID();
  const channel = "EMAIL" as const;
  const template = "EMAIL_VERIFICATION_CODE_V1";
  return {
    deliveryId,
    verificationId,
    channel,
    template,
    encryptedPayload: encryptDeliveryCommand(
      command,
      deliveryEncryptionContext({ deliveryId, verificationId, channel, template }),
      keyring,
    ),
    attemptCount: 0,
    leaseToken: "lease_token_fixture_1234567890",
  };
}

function harness(outcome: DeliveryOutcome) {
  const provider: DeliveryProvider = {
    send: vi.fn(async () => outcome),
  };
  const complete = vi.fn(async () => "COMPLETED" as const);
  const reportFailure = vi.fn(async () => "RETRY_SCHEDULED" as const);
  const persistence: VerificationDeliveryPersistence = { complete, reportFailure };
  return { provider, persistence, complete, reportFailure };
}

describe("verification delivery Worker core", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["true", false],
    ["TRUE", false],
    ["0", false],
    ["false", true],
  ])("treats kill-switch value %j as claims-enabled=%j", (value, enabled) => {
    expect(deliveryClaimsEnabled(value)).toBe(enabled);
  });

  it("decrypts for the provider and completes a successful delivery", async () => {
    const delivery = claimedDelivery();
    const { provider, persistence, complete, reportFailure } = harness({ type: "SUCCESS" });

    const result = await processClaimedVerificationDelivery({
      delivery,
      keyring,
      provider,
      persistence,
      now,
    });

    expect(provider.send).toHaveBeenCalledExactlyOnceWith(command);
    expect(complete).toHaveBeenCalledExactlyOnceWith(delivery.deliveryId, delivery.leaseToken, now);
    expect(reportFailure).not.toHaveBeenCalled();
    expect(result).toBe("COMPLETED");
  });

  it.each<{
    providerOutcome: DeliveryOutcome;
    expectedFailure: ReportVerificationDeliveryFailureOptions;
  }>([
    {
      providerOutcome: { type: "PERMANENT_REJECTION" },
      expectedFailure: {
        deliveryId: "replaced",
        leaseToken: "replaced",
        outcome: "PERMANENT",
        now,
      },
    },
    {
      providerOutcome: { type: "RATE_LIMITED", retryAfterSeconds: 90 },
      expectedFailure: {
        deliveryId: "replaced",
        leaseToken: "replaced",
        outcome: "TRANSIENT",
        retryAfterSeconds: 90,
        now,
      },
    },
    {
      providerOutcome: { type: "TRANSIENT" },
      expectedFailure: {
        deliveryId: "replaced",
        leaseToken: "replaced",
        outcome: "TRANSIENT",
        now,
      },
    },
  ])("maps $providerOutcome.type to bounded failure persistence", async (testCase) => {
    const delivery = claimedDelivery();
    const { provider, persistence, complete, reportFailure } = harness(testCase.providerOutcome);

    await processClaimedVerificationDelivery({
      delivery,
      keyring,
      provider,
      persistence,
      now,
    });

    expect(provider.send).toHaveBeenCalledExactlyOnceWith(command);
    expect(complete).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith({
      ...testCase.expectedFailure,
      deliveryId: delivery.deliveryId,
      leaseToken: delivery.leaseToken,
    });
  });

  it("dead-letters malformed authenticated plaintext before provider access", async () => {
    const delivery = claimedDelivery();
    const context = deliveryEncryptionContext(delivery);
    const malformedDelivery = {
      ...delivery,
      encryptedPayload: encryptSensitiveValue(
        JSON.stringify({ ...command, userControlledContent: "not-allowed" }),
        context,
        keyring,
      ),
    };
    const { provider, persistence, complete, reportFailure } = harness({ type: "SUCCESS" });

    await processClaimedVerificationDelivery({
      delivery: malformedDelivery,
      keyring,
      provider,
      persistence,
      now,
    });

    expect(provider.send).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith({
      deliveryId: delivery.deliveryId,
      leaseToken: delivery.leaseToken,
      outcome: "PERMANENT",
      now,
    });
  });

  it("preserves ciphertext for recovery when decryption authority is wrong", async () => {
    const delivery = claimedDelivery();
    const wrongKeyring = createDeliveryKeyring({
      keyId: keyring.keyId,
      encryptionKeyBase64: Buffer.alloc(32, 90).toString("base64"),
    });
    const { provider, persistence, complete, reportFailure } = harness({ type: "SUCCESS" });

    await expect(
      processClaimedVerificationDelivery({
        delivery,
        keyring: wrongKeyring,
        provider,
        persistence,
        now,
      }),
    ).rejects.toThrowError("DELIVERY_COMMAND_DECRYPT_FAILED");

    expect(provider.send).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("routes a thrown provider call through transient retry", async () => {
    const delivery = claimedDelivery();
    const provider: DeliveryProvider = {
      send: vi.fn(async () => {
        throw new Error("provider response must not escape");
      }),
    };
    const complete = vi.fn(async () => "COMPLETED" as const);
    const reportFailure = vi.fn(async () => "RETRY_SCHEDULED" as const);

    const result = await processClaimedVerificationDelivery({
      delivery,
      keyring,
      provider,
      persistence: { complete, reportFailure },
      now,
    });

    expect(complete).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith({
      deliveryId: delivery.deliveryId,
      leaseToken: delivery.leaseToken,
      outcome: "TRANSIENT",
      now,
    });
    expect(result).toBe("RETRY_SCHEDULED");
  });
});

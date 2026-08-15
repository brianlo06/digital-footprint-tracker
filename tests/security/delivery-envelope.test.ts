import { createDeliveryKeyring, encryptSensitiveValue } from "@/security/crypto";
import {
  decryptDeliveryCommand,
  deliveryEncryptionContext,
  encryptDeliveryCommand,
  type DeliveryCommandPayload,
} from "@/verification/delivery-envelope";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const keyring = createDeliveryKeyring({
  keyId: "delivery-envelope-test-v1",
  encryptionKeyBase64: Buffer.alloc(32, 83).toString("base64"),
});

function context(): string {
  return deliveryEncryptionContext({
    deliveryId: randomUUID(),
    verificationId: randomUUID(),
    channel: "EMAIL",
    template: "EMAIL_VERIFICATION_CODE_V1",
  });
}

describe("verification delivery envelope", () => {
  it("round-trips only a normalized destination and six-digit code", () => {
    const encryptionContext = context();
    const command = { destination: "fixture@example.test", code: "000000" };

    const envelope = encryptDeliveryCommand(command, encryptionContext, keyring);

    expect(decryptDeliveryCommand(envelope, encryptionContext, keyring)).toEqual(command);
  });

  it.each<DeliveryCommandPayload>([
    { destination: "Fixture@example.test", code: "000000" },
    { destination: " fixture@example.test", code: "000000" },
    { destination: "not-an-email", code: "000000" },
    { destination: "fixture@example.test", code: "12345" },
    { destination: "fixture@example.test", code: "12345x" },
  ])("rejects a non-canonical command before encryption", (command) => {
    expect(() => encryptDeliveryCommand(command, context(), keyring)).toThrowError(
      "DELIVERY_COMMAND_INVALID",
    );
  });

  it.each([
    "not-json",
    JSON.stringify({ destination: "fixture@example.test", code: "000000", extra: true }),
    JSON.stringify({ destination: "delivery-canary@example.test", code: 123456 }),
  ])("rejects an authenticated but malformed command with a value-free error", (plaintext) => {
    const encryptionContext = context();
    const envelope = encryptSensitiveValue(plaintext, encryptionContext, keyring);

    expect(() => decryptDeliveryCommand(envelope, encryptionContext, keyring)).toThrowError(
      "DELIVERY_COMMAND_INVALID",
    );

    try {
      decryptDeliveryCommand(envelope, encryptionContext, keyring);
    } catch (error) {
      expect(error).toEqual(new Error("DELIVERY_COMMAND_INVALID"));
      expect(String(error)).not.toContain("delivery-canary@example.test");
      expect(String(error)).not.toContain(plaintext);
    }
  });

  it("distinguishes a key or context failure without exposing ciphertext", () => {
    const encryptionContext = context();
    const envelope = encryptDeliveryCommand(
      { destination: "fixture@example.test", code: "000000" },
      encryptionContext,
      keyring,
    );

    expect(() =>
      decryptDeliveryCommand(envelope, `${encryptionContext}:wrong`, keyring),
    ).toThrowError("DELIVERY_COMMAND_DECRYPT_FAILED");

    try {
      decryptDeliveryCommand(envelope, `${encryptionContext}:wrong`, keyring);
    } catch (error) {
      expect(error).toEqual(new Error("DELIVERY_COMMAND_DECRYPT_FAILED"));
      expect(String(error)).not.toContain(envelope.ciphertext);
    }
  });
});

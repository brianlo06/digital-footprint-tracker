import {
  createDeliveryKeyring,
  decryptSensitiveValue,
  encryptSensitiveValue,
} from "@/security/crypto";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

function testKeyring() {
  return createDeliveryKeyring({
    keyId: "test-delivery-v1",
    encryptionKeyBase64: randomBytes(32).toString("base64"),
  });
}

describe("delivery keyring", () => {
  it("requires exactly 32-byte key material", () => {
    expect(() =>
      createDeliveryKeyring({
        keyId: "short",
        encryptionKeyBase64: Buffer.alloc(16).toString("base64"),
      }),
    ).toThrow("must be exactly 32 bytes");
  });

  it("round-trips a sensitive value through envelope encryption", () => {
    const keyring = testKeyring();
    const envelope = encryptSensitiveValue("hello@example.test", "delivery:1", keyring);

    expect(decryptSensitiveValue(envelope, "delivery:1", keyring)).toBe("hello@example.test");
    expect(() => decryptSensitiveValue(envelope, "delivery:2", keyring)).toThrow();
  });
});

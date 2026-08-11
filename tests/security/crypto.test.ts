import {
  challengeMatches,
  createChallengeHash,
  createKeyring,
  createLookupToken,
  decryptSensitiveValue,
  encryptSensitiveValue,
  rewrapEncryptedEnvelope,
} from "@/security/crypto";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

function testKeyring() {
  return createKeyring({
    keyId: "test-v1",
    encryptionKeyBase64: randomBytes(32).toString("base64"),
    lookupKeyBase64: randomBytes(32).toString("base64"),
  });
}

describe("sensitive-value envelope encryption", () => {
  it("round-trips only with the same authenticated context", () => {
    const keyring = testKeyring();
    const envelope = encryptSensitiveValue("person@example.test", "identifier:1:value", keyring);

    expect(decryptSensitiveValue(envelope, "identifier:1:value", keyring)).toBe(
      "person@example.test",
    );
    expect(() => decryptSensitiveValue(envelope, "identifier:2:value", keyring)).toThrow();
  });

  it("uses fresh data keys and nonces", () => {
    const keyring = testKeyring();
    const first = encryptSensitiveValue("same@example.test", "same-context", keyring);
    const second = encryptSensitiveValue("same@example.test", "same-context", keyring);

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.wrappedDataKey).not.toBe(second.wrappedDataKey);
  });

  it("rewraps the data key without changing the encrypted value", () => {
    const currentKeyring = testKeyring();
    const nextKeyring = createKeyring({
      keyId: "test-v2",
      encryptionKeyBase64: randomBytes(32).toString("base64"),
      lookupKeyBase64: randomBytes(32).toString("base64"),
    });
    const envelope = encryptSensitiveValue(
      "rotation@example.test",
      "identifier:rotation:value",
      currentKeyring,
    );
    const rotated = rewrapEncryptedEnvelope(envelope, currentKeyring, nextKeyring);

    expect(rotated.ciphertext).toBe(envelope.ciphertext);
    expect(rotated.nonce).toBe(envelope.nonce);
    expect(rotated.authTag).toBe(envelope.authTag);
    expect(rotated.keyId).toBe("test-v2");
    expect(rotated.wrappedDataKey).not.toBe(envelope.wrappedDataKey);
    expect(decryptSensitiveValue(rotated, "identifier:rotation:value", nextKeyring)).toBe(
      "rotation@example.test",
    );
    expect(() =>
      decryptSensitiveValue(rotated, "identifier:rotation:value", currentKeyring),
    ).toThrow("not available");
  });

  it("creates deterministic, namespace-bound lookup tokens", () => {
    const keyring = testKeyring();
    const first = createLookupToken("person@example.test", "email:v1", keyring);
    const second = createLookupToken("person@example.test", "email:v1", keyring);
    const otherNamespace = createLookupToken("person@example.test", "username:v1", keyring);

    expect(first).toBe(second);
    expect(first).not.toBe(otherNamespace);
    expect(first).not.toContain("person");
  });

  it("compares purpose-bound challenge hashes", () => {
    const keyring = testKeyring();
    const expected = createChallengeHash("000000", "challenge-1", keyring);
    const matching = createChallengeHash("000000", "challenge-1", keyring);
    const replayedElsewhere = createChallengeHash("000000", "challenge-2", keyring);

    expect(challengeMatches(expected, matching)).toBe(true);
    expect(challengeMatches(expected, replayedElsewhere)).toBe(false);
  });
});

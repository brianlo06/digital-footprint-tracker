import { rewrapIdentifierBatch } from "@/security/key-rotation-service";
import { createKeyring } from "@/security/crypto";
import { describe, expect, it } from "vitest";

function keyring(keyId: string, encryptionByte: number, lookupByte = 91) {
  return createKeyring({
    keyId,
    encryptionKeyBase64: Buffer.alloc(32, encryptionByte).toString("base64"),
    lookupKeyBase64: Buffer.alloc(32, lookupByte).toString("base64"),
  });
}

describe("identifier key rotation policy", () => {
  it("rejects invalid batch sizes before database access", async () => {
    await expect(
      rewrapIdentifierBatch({
        currentKeyring: keyring("current", 1),
        nextKeyring: keyring("next", 2),
        batchSize: 0,
      }),
    ).rejects.toThrow("KEY_ROTATION_BATCH_SIZE_INVALID");
  });

  it("requires a real key-encryption-key change", async () => {
    await expect(
      rewrapIdentifierBatch({
        currentKeyring: keyring("same", 1),
        nextKeyring: keyring("same", 2),
      }),
    ).rejects.toThrow("KEY_ROTATION_IDS_MUST_DIFFER");

    await expect(
      rewrapIdentifierBatch({
        currentKeyring: keyring("current", 1),
        nextKeyring: keyring("next", 1),
      }),
    ).rejects.toThrow("KEY_ROTATION_KEYS_MUST_DIFFER");
  });

  it("refuses to mix lookup-token rotation into envelope rewrap", async () => {
    await expect(
      rewrapIdentifierBatch({
        currentKeyring: keyring("current", 1, 3),
        nextKeyring: keyring("next", 2, 4),
      }),
    ).rejects.toThrow("LOOKUP_KEY_ROTATION_REQUIRES_SEPARATE_PROCEDURE");
  });
});

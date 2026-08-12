import { createKeyring } from "@/security/crypto";
import { createLookupKeyring } from "@/security/lookup-keyring";
import { migrateLookupTokenBatch } from "@/security/lookup-rotation-service";
import { describe, expect, it } from "vitest";

function envelopeKeyring() {
  return createKeyring({
    keyId: "envelope-v1",
    encryptionKeyBase64: Buffer.alloc(32, 5).toString("base64"),
    lookupKeyBase64: Buffer.alloc(32, 6).toString("base64"),
  });
}

function targetKeyring(keyId: string, byte = 7) {
  return createLookupKeyring({
    keyId,
    lookupKeyBase64: Buffer.alloc(32, byte).toString("base64"),
  });
}

describe("lookup-token rotation worker policy", () => {
  it("rejects invalid batch sizes before database access", async () => {
    await expect(
      migrateLookupTokenBatch({
        envelopeKeyring: envelopeKeyring(),
        targetLookupKeyring: targetKeyring("target-v1"),
        batchSize: 0,
      }),
    ).rejects.toThrow("LOOKUP_KEY_ROTATION_BATCH_SIZE_INVALID");

    await expect(
      migrateLookupTokenBatch({
        envelopeKeyring: envelopeKeyring(),
        targetLookupKeyring: targetKeyring("target-v1"),
        batchSize: 1_001,
      }),
    ).rejects.toThrow("LOOKUP_KEY_ROTATION_BATCH_SIZE_INVALID");
  });

  it("rejects an empty target lookup-key ID before database access", async () => {
    await expect(
      migrateLookupTokenBatch({
        envelopeKeyring: envelopeKeyring(),
        targetLookupKeyring: { keyId: "", lookupKey: Buffer.alloc(32, 7) },
      }),
    ).rejects.toThrow("LOOKUP_KEY_ROTATION_TARGET_KEY_ID_INVALID");
  });

  it("rejects an oversized target lookup-key ID before database access", async () => {
    await expect(
      migrateLookupTokenBatch({
        envelopeKeyring: envelopeKeyring(),
        targetLookupKeyring: { keyId: "x".repeat(65), lookupKey: Buffer.alloc(32, 7) },
      }),
    ).rejects.toThrow("LOOKUP_KEY_ROTATION_TARGET_KEY_ID_INVALID");
  });
});

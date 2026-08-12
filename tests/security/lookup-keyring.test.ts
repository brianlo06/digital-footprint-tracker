import { createLookupKeyring, validateLookupKeyringRegistry } from "@/security/lookup-keyring";
import { describe, expect, it } from "vitest";

function keyring(keyId: string, byte: number) {
  return createLookupKeyring({
    keyId,
    lookupKeyBase64: Buffer.alloc(32, byte).toString("base64"),
  });
}

describe("lookup-key registry validation", () => {
  it("permits a registry with only a current key", () => {
    expect(() => validateLookupKeyringRegistry(keyring("current", 1))).not.toThrow();
  });

  it("rejects a previous key with the same ID as the current key", () => {
    expect(() => validateLookupKeyringRegistry(keyring("same", 1), keyring("same", 2))).toThrow(
      "LOOKUP_KEY_ROTATION_IDS_MUST_DIFFER",
    );
  });

  it("rejects a previous key with identical key material", () => {
    expect(() =>
      validateLookupKeyringRegistry(keyring("current", 1), keyring("previous", 1)),
    ).toThrow("LOOKUP_KEY_ROTATION_KEYS_MUST_DIFFER");
  });

  it("accepts a previous key with a distinct ID and material", () => {
    expect(() =>
      validateLookupKeyringRegistry(keyring("current", 1), keyring("previous", 2)),
    ).not.toThrow();
  });

  it("requires exactly 32-byte key material", () => {
    expect(() =>
      createLookupKeyring({ keyId: "short", lookupKeyBase64: Buffer.alloc(16).toString("base64") }),
    ).toThrow("must be exactly 32 bytes");
  });
});

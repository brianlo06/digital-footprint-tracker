import "server-only";

import { getServerEnv } from "@/config/server-env";
import { assertKeyLength } from "./crypto";

export interface LookupKeyring {
  readonly keyId: string;
  readonly lookupKey: Buffer;
}

export interface LookupKeyringRegistry {
  readonly current: LookupKeyring;
  readonly previous?: LookupKeyring;
}

export function createLookupKeyring(input: {
  keyId: string;
  lookupKeyBase64: string;
}): LookupKeyring {
  const lookupKey = Buffer.from(input.lookupKeyBase64, "base64");
  assertKeyLength(lookupKey, "lookupKey");
  return { keyId: input.keyId, lookupKey };
}

export function validateLookupKeyringRegistry(
  current: LookupKeyring,
  previous?: LookupKeyring,
): void {
  if (!previous) return;
  if (current.keyId === previous.keyId) {
    throw new Error("LOOKUP_KEY_ROTATION_IDS_MUST_DIFFER");
  }
  if (current.lookupKey.equals(previous.lookupKey)) {
    throw new Error("LOOKUP_KEY_ROTATION_KEYS_MUST_DIFFER");
  }
}

/**
 * Deliberately separate from the envelope EncryptionKeyring: lookup-key
 * configuration must be able to change without also touching KEK rewrap,
 * per ADR 0016.
 */
export function getApplicationLookupKeyring(): LookupKeyringRegistry {
  const env = getServerEnv();
  const current = createLookupKeyring({
    keyId: env.LOOKUP_KEY_ID,
    lookupKeyBase64: env.LOOKUP_KEY,
  });
  const previous =
    env.PREVIOUS_LOOKUP_KEY_ID && env.PREVIOUS_LOOKUP_KEY
      ? createLookupKeyring({
          keyId: env.PREVIOUS_LOOKUP_KEY_ID,
          lookupKeyBase64: env.PREVIOUS_LOOKUP_KEY,
        })
      : undefined;

  validateLookupKeyringRegistry(current, previous);

  return previous ? { current, previous } : { current };
}

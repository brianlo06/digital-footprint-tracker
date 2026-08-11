import "server-only";

import { getServerEnv } from "@/config/server-env";
import { createKeyring } from "./crypto";

export function getApplicationKeyring() {
  const env = getServerEnv();
  return createKeyring({
    keyId: env.ENCRYPTION_KEY_ID,
    encryptionKeyBase64: env.ENCRYPTION_KEY,
    lookupKeyBase64: env.LOOKUP_KEY,
  });
}

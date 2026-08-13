import "server-only";

import { getServerEnv } from "@/config/server-env";
import { createDeliveryKeyring, type DeliveryKeyring } from "./crypto";

/**
 * Undefined in the default Phase 1 state: no delivery outbox writer is wired
 * in until a provider is approved. Callers that need it assert non-undefined
 * themselves.
 */
export function getApplicationDeliveryKeyring(): DeliveryKeyring | undefined {
  const env = getServerEnv();
  if (!env.DELIVERY_ENCRYPTION_KEY_ID || !env.DELIVERY_ENCRYPTION_KEY) return undefined;

  return createDeliveryKeyring({
    keyId: env.DELIVERY_ENCRYPTION_KEY_ID,
    encryptionKeyBase64: env.DELIVERY_ENCRYPTION_KEY,
  });
}

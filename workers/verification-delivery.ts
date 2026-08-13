import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/database/schema";
import { createDeliveryKeyring } from "../src/security/crypto";
import {
  decryptDeliveryCommand,
  deliveryEncryptionContext,
} from "../src/verification/delivery-envelope";
import {
  claimVerificationDeliveries,
  completeVerificationDelivery,
  reportVerificationDeliveryFailure,
} from "../src/verification/delivery-outbox-core";
import {
  SyntheticNoopDeliveryProvider,
  type DeliveryProvider,
} from "../src/verification/delivery-provider";

interface SecretsStoreSecret {
  get(): Promise<string>;
}

interface VerificationDeliveryWorkerEnv {
  readonly DELIVERY_DATABASE: { readonly connectionString: string };
  readonly DELIVERY_ENCRYPTION_KEY_ID: string;
  readonly DELIVERY_ENCRYPTION_KEY: SecretsStoreSecret;
  readonly DELIVERY_KILL_SWITCH?: string;
  readonly DELIVERY_CLAIM_BATCH_SIZE?: string;
  readonly DELIVERY_CLAIM_LEASE_SECONDS?: string;
}

interface ScheduledEvent {
  readonly scheduledTime: number;
}

function integerSetting(value: string | undefined, fallback: number, code: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(code);
  return Number(value);
}

const verificationDeliveryWorker = {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller: ScheduledEvent, env: VerificationDeliveryWorkerEnv): Promise<void> {
    // Default-on: any value other than the explicit opt-out blocks claiming,
    // so an accidental deployment or a missing/misconfigured variable fails
    // closed instead of silently starting to send.
    if (env.DELIVERY_KILL_SWITCH !== "false") return;

    const now = new Date(controller.scheduledTime);
    const client = postgres(env.DELIVERY_DATABASE.connectionString, {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 20,
      prepare: true,
    });
    try {
      const database = drizzle(client, { schema });
      const keyring = createDeliveryKeyring({
        keyId: env.DELIVERY_ENCRYPTION_KEY_ID,
        encryptionKeyBase64: await env.DELIVERY_ENCRYPTION_KEY.get(),
      });
      // Phase 1: no real provider is approved yet. A hosted deployment must
      // replace this with an approved provider before it can send anything.
      const provider: DeliveryProvider = new SyntheticNoopDeliveryProvider();

      const claimed = await claimVerificationDeliveries(database, {
        now,
        batchSize: integerSetting(
          env.DELIVERY_CLAIM_BATCH_SIZE,
          25,
          "DELIVERY_CLAIM_BATCH_SIZE_INVALID",
        ),
        leaseSeconds: integerSetting(
          env.DELIVERY_CLAIM_LEASE_SECONDS,
          120,
          "DELIVERY_CLAIM_LEASE_SECONDS_INVALID",
        ),
      });

      for (const delivery of claimed) {
        const context = deliveryEncryptionContext({
          deliveryId: delivery.deliveryId,
          verificationId: delivery.verificationId,
          channel: delivery.channel,
          template: delivery.template,
        });
        const command = decryptDeliveryCommand(delivery.encryptedPayload, context, keyring);
        const outcome = await provider.send(command);

        switch (outcome.type) {
          case "SUCCESS":
            await completeVerificationDelivery(
              database,
              delivery.deliveryId,
              delivery.leaseToken,
              now,
            );
            break;
          case "PERMANENT_REJECTION":
            await reportVerificationDeliveryFailure(database, {
              deliveryId: delivery.deliveryId,
              leaseToken: delivery.leaseToken,
              outcome: "PERMANENT",
              now,
            });
            break;
          case "RATE_LIMITED":
            await reportVerificationDeliveryFailure(database, {
              deliveryId: delivery.deliveryId,
              leaseToken: delivery.leaseToken,
              outcome: "TRANSIENT",
              retryAfterSeconds: outcome.retryAfterSeconds,
              now,
            });
            break;
          case "TRANSIENT":
            await reportVerificationDeliveryFailure(database, {
              deliveryId: delivery.deliveryId,
              leaseToken: delivery.leaseToken,
              outcome: "TRANSIENT",
              now,
            });
            break;
        }
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  },
};

export default verificationDeliveryWorker;

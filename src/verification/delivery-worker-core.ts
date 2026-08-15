import type { DeliveryKeyring } from "@/security/crypto";
import {
  type ClaimedVerificationDelivery,
  type CompleteVerificationDeliveryOutcome,
  type ReportVerificationDeliveryFailureOptions,
  type ReportVerificationDeliveryFailureOutcome,
} from "@/verification/delivery-outbox-core";
import {
  decryptDeliveryCommand,
  deliveryEncryptionContext,
} from "@/verification/delivery-envelope";
import type { DeliveryProvider } from "@/verification/delivery-provider";

export interface VerificationDeliveryPersistence {
  complete(
    deliveryId: string,
    leaseToken: string,
    now: Date,
  ): Promise<CompleteVerificationDeliveryOutcome>;
  reportFailure(
    options: ReportVerificationDeliveryFailureOptions,
  ): Promise<ReportVerificationDeliveryFailureOutcome>;
}

export function deliveryClaimsEnabled(killSwitch: string | undefined): boolean {
  return killSwitch === "false";
}

/**
 * Decrypts one already-claimed command and maps the provider's bounded outcome
 * to the matching compare-and-swap persistence operation. Provider adapters
 * never receive the envelope, lease token, database handle, or keyring.
 */
export async function processClaimedVerificationDelivery(input: {
  readonly delivery: ClaimedVerificationDelivery;
  readonly keyring: DeliveryKeyring;
  readonly provider: DeliveryProvider;
  readonly persistence: VerificationDeliveryPersistence;
  readonly now: Date;
}): Promise<CompleteVerificationDeliveryOutcome | ReportVerificationDeliveryFailureOutcome> {
  const { delivery, keyring, provider, persistence, now } = input;
  const context = deliveryEncryptionContext({
    deliveryId: delivery.deliveryId,
    verificationId: delivery.verificationId,
    channel: delivery.channel,
    template: delivery.template,
  });
  let command;
  try {
    command = decryptDeliveryCommand(delivery.encryptedPayload, context, keyring);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "DELIVERY_COMMAND_INVALID") throw error;
    return persistence.reportFailure({
      deliveryId: delivery.deliveryId,
      leaseToken: delivery.leaseToken,
      outcome: "PERMANENT",
      now,
    });
  }

  let outcome;
  try {
    outcome = await provider.send(command);
  } catch {
    return persistence.reportFailure({
      deliveryId: delivery.deliveryId,
      leaseToken: delivery.leaseToken,
      outcome: "TRANSIENT",
      now,
    });
  }

  switch (outcome.type) {
    case "SUCCESS":
      return persistence.complete(delivery.deliveryId, delivery.leaseToken, now);
    case "PERMANENT_REJECTION":
      return persistence.reportFailure({
        deliveryId: delivery.deliveryId,
        leaseToken: delivery.leaseToken,
        outcome: "PERMANENT",
        now,
      });
    case "RATE_LIMITED":
      return persistence.reportFailure({
        deliveryId: delivery.deliveryId,
        leaseToken: delivery.leaseToken,
        outcome: "TRANSIENT",
        retryAfterSeconds: outcome.retryAfterSeconds,
        now,
      });
    case "TRANSIENT":
      return persistence.reportFailure({
        deliveryId: delivery.deliveryId,
        leaseToken: delivery.leaseToken,
        outcome: "TRANSIENT",
        now,
      });
  }
}

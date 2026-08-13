import "server-only";

import { withDeliveryDatabase } from "@/database/client";
import {
  assertClaimOptions,
  assertReportFailureOptions,
  claimVerificationDeliveries as claimVerificationDeliveriesCore,
  completeVerificationDelivery as completeVerificationDeliveryCore,
  reportVerificationDeliveryFailure as reportVerificationDeliveryFailureCore,
  type ClaimedVerificationDelivery,
  type ClaimVerificationDeliveriesOptions,
  type CompleteVerificationDeliveryOutcome,
  type ReportVerificationDeliveryFailureOptions,
  type ReportVerificationDeliveryFailureOutcome,
} from "@/verification/delivery-outbox-core";

export type {
  ClaimedVerificationDelivery,
  ClaimVerificationDeliveriesOptions,
  CompleteVerificationDeliveryOutcome,
  ReportVerificationDeliveryFailureOptions,
  ReportVerificationDeliveryFailureOutcome,
};

/**
 * Not scheduled in Phase 1; the standalone Worker (workers/verification-delivery.ts)
 * has no approved hosted deployment yet and is exercised only by tests
 * driving it directly against local Postgres.
 */
export async function claimVerificationDeliveries(
  options: ClaimVerificationDeliveriesOptions = {},
): Promise<readonly ClaimedVerificationDelivery[]> {
  assertClaimOptions(options);
  return withDeliveryDatabase((database) => claimVerificationDeliveriesCore(database, options));
}

export async function completeVerificationDelivery(
  deliveryId: string,
  leaseToken: string,
  now?: Date,
): Promise<CompleteVerificationDeliveryOutcome> {
  return withDeliveryDatabase((database) =>
    completeVerificationDeliveryCore(database, deliveryId, leaseToken, now),
  );
}

export async function reportVerificationDeliveryFailure(
  options: ReportVerificationDeliveryFailureOptions,
): Promise<ReportVerificationDeliveryFailureOutcome> {
  assertReportFailureOptions(options);
  return withDeliveryDatabase((database) =>
    reportVerificationDeliveryFailureCore(database, options),
  );
}

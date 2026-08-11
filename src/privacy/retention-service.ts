import "server-only";

import { withMaintenanceDatabase } from "@/database/client";
import {
  assertRetentionMaintenanceOptions,
  executeRetentionMaintenance,
  type RetentionMaintenanceOptions,
  type RetentionMaintenanceResult,
} from "@/privacy/retention-core";

export type { RetentionMaintenanceOptions, RetentionMaintenanceResult };

/**
 * Performs one bounded, idempotent retention batch. It is intentionally not
 * scheduled in Phase 1; a later operational design must supply locking,
 * metrics, authorization, and invocation policy.
 */
export async function runRetentionMaintenance(
  options: RetentionMaintenanceOptions = {},
): Promise<RetentionMaintenanceResult> {
  assertRetentionMaintenanceOptions(options);
  return withMaintenanceDatabase((database) => executeRetentionMaintenance(database, options));
}

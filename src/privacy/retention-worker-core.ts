import {
  assertRetentionMaintenanceOptions,
  type RetentionMaintenanceOptions,
} from "@/privacy/retention-core";

export interface RetentionWorkerSettings {
  readonly scheduledTime: number;
  readonly batchSize: string;
  readonly orphanAuditRetentionDays: string;
}

function integerSetting(value: string, code: string): number {
  if (!/^\d+$/.test(value)) throw new Error(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(code);
  return parsed;
}

/** Parses untrusted runtime bindings before the Worker opens a database client. */
export function retentionOptionsFromWorkerSettings(
  settings: RetentionWorkerSettings,
): Required<RetentionMaintenanceOptions> {
  const options = {
    now: new Date(settings.scheduledTime),
    batchSize: integerSetting(settings.batchSize, "RETENTION_BATCH_SIZE_INVALID"),
    orphanAuditRetentionDays: integerSetting(
      settings.orphanAuditRetentionDays,
      "AUDIT_RETENTION_DAYS_INVALID",
    ),
  };
  assertRetentionMaintenanceOptions(options);
  return options;
}

export async function executeRetentionWorkerSchedule<Result>(
  settings: RetentionWorkerSettings,
  execute: (options: Required<RetentionMaintenanceOptions>) => Promise<Result>,
): Promise<Result> {
  const options = retentionOptionsFromWorkerSettings(settings);
  return execute(options);
}

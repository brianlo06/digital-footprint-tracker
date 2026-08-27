import {
  assertBreachScanClaimOptions,
  type ClaimBreachScanJobsOptions,
  type ClaimedBreachScanJob,
} from "@/providers/breach/breach-scan-job-core";
import type { ProcessClaimedBreachScanResult } from "@/providers/breach/breach-scan-worker";

export interface BreachScanWorkerSettings {
  readonly scheduledTime: number;
  readonly invocationTime?: number;
  readonly killSwitch: string | undefined;
  readonly syntheticEnabled: string | undefined;
  readonly batchSize: string | undefined;
  readonly leaseSeconds: string | undefined;
}

export interface BreachScanWorkerOptions {
  readonly now: Date;
  readonly batchSize: number;
  readonly leaseSeconds: number;
}

export interface BreachScanWorkerSummary {
  readonly status: "DISABLED" | "PROCESSED";
  readonly claimed: number;
  readonly skipped: number;
  readonly completed: number;
  readonly retryScheduled: number;
  readonly deadLettered: number;
  readonly systemFailures: number;
}

export interface BreachScanWorkerDependencies {
  claim(options: BreachScanWorkerOptions): Promise<readonly ClaimedBreachScanJob[]>;
  process(job: ClaimedBreachScanJob, now: Date): Promise<ProcessClaimedBreachScanResult>;
  reportSystemFailure?(input: {
    readonly jobId: string;
    readonly scanId: string;
    readonly error: unknown;
  }): void;
  currentTime?(): Date;
}

const DISABLED_SUMMARY: BreachScanWorkerSummary = Object.freeze({
  status: "DISABLED",
  claimed: 0,
  skipped: 0,
  completed: 0,
  retryScheduled: 0,
  deadLettered: 0,
  systemFailures: 0,
});

function integerSetting(value: string | undefined, fallback: number, code: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(code);
  return parsed;
}

/** Both independent gates must be set exactly, so missing or mistyped
 * bindings keep the scheduled consumer inert. */
export function breachScanWorkerEnabled(
  killSwitch: string | undefined,
  syntheticEnabled: string | undefined,
): boolean {
  return killSwitch === "false" && syntheticEnabled === "true";
}

/** Parses untrusted Worker bindings before a database connection is opened. */
export function breachScanOptionsFromWorkerSettings(
  settings: BreachScanWorkerSettings,
): BreachScanWorkerOptions {
  const now = new Date(settings.scheduledTime);
  if (!Number.isFinite(settings.scheduledTime) || !Number.isFinite(now.getTime())) {
    throw new Error("SCAN_JOB_NOW_INVALID");
  }
  const invocationNow = new Date(settings.invocationTime ?? Date.now());
  if (!Number.isFinite(invocationNow.getTime())) throw new Error("SCAN_JOB_NOW_INVALID");

  const options: Required<Pick<ClaimBreachScanJobsOptions, "batchSize" | "leaseSeconds">> = {
    batchSize: integerSetting(settings.batchSize, 10, "SCAN_JOB_BATCH_SIZE_INVALID"),
    leaseSeconds: integerSetting(settings.leaseSeconds, 120, "SCAN_JOB_LEASE_SECONDS_INVALID"),
  };
  assertBreachScanClaimOptions(options);
  return { now: invocationNow, ...options };
}

/**
 * Claims one bounded batch and isolates processing failures by job. A thrown
 * processor error leaves that job's expiring lease recoverable while the
 * remaining claims continue through the same scheduled invocation.
 */
export async function executeBreachScanWorkerSchedule(
  settings: BreachScanWorkerSettings,
  dependencies: BreachScanWorkerDependencies,
): Promise<BreachScanWorkerSummary> {
  if (!breachScanWorkerEnabled(settings.killSwitch, settings.syntheticEnabled)) {
    return DISABLED_SUMMARY;
  }

  const options = breachScanOptionsFromWorkerSettings(settings);
  const claimed = await dependencies.claim(options);
  const totals = {
    skipped: 0,
    completed: 0,
    retryScheduled: 0,
    deadLettered: 0,
    systemFailures: 0,
  };

  for (const job of claimed) {
    try {
      const processingNow = dependencies.currentTime?.() ?? new Date();
      if (!Number.isFinite(processingNow.getTime())) throw new Error("SCAN_JOB_NOW_INVALID");
      const result = await dependencies.process(job, processingNow);
      switch (result) {
        case "SKIPPED":
          totals.skipped += 1;
          break;
        case "COMPLETED":
          totals.completed += 1;
          break;
        case "RETRY_SCHEDULED":
          totals.retryScheduled += 1;
          break;
        case "DEAD_LETTERED":
          totals.deadLettered += 1;
          break;
      }
    } catch (error) {
      totals.systemFailures += 1;
      dependencies.reportSystemFailure?.({ jobId: job.jobId, scanId: job.scanId, error });
    }
  }

  return { status: "PROCESSED", claimed: claimed.length, ...totals };
}

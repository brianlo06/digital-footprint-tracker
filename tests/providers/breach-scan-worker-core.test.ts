import type { ClaimedBreachScanJob } from "@/providers/breach/breach-scan-job-core";
import {
  breachScanOptionsFromWorkerSettings,
  breachScanWorkerEnabled,
  executeBreachScanWorkerSchedule,
} from "@/providers/breach/breach-scan-worker-core";
import { describe, expect, it, vi } from "vitest";

const scheduledTime = new Date("2026-08-26T16:30:00.000Z").getTime();

function claimedJob(sequence: number): ClaimedBreachScanJob {
  return {
    jobId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    scanId: `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    userId: `20000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    identityId: `30000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    identifierId: `40000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    consentRecordId: `50000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    authSubject: `synthetic_subject_${sequence}`,
    attemptCount: 1,
    maxAttempts: 3,
    leaseToken: `synthetic-lease-${sequence}`,
  };
}

const enabledSettings = {
  scheduledTime,
  invocationTime: scheduledTime,
  killSwitch: "false",
  syntheticEnabled: "true",
  batchSize: "10",
  leaseSeconds: "120",
} as const;

describe("breach scan Worker core", () => {
  it.each([
    ["false", "true", true],
    ["true", "true", false],
    ["false", "false", false],
    [undefined, "true", false],
    ["false", undefined, false],
    ["FALSE", "true", false],
    ["false", "TRUE", false],
  ])("treats kill=%j synthetic=%j as enabled=%j", (killSwitch, syntheticEnabled, enabled) => {
    expect(breachScanWorkerEnabled(killSwitch, syntheticEnabled)).toBe(enabled);
  });

  it("returns before validating settings or accessing persistence when either gate is closed", async () => {
    const claim = vi.fn();
    const process = vi.fn();

    await expect(
      executeBreachScanWorkerSchedule(
        {
          scheduledTime: Number.NaN,
          killSwitch: "true",
          syntheticEnabled: "true",
          batchSize: "invalid",
          leaseSeconds: "invalid",
        },
        { claim, process },
      ),
    ).resolves.toEqual({
      status: "DISABLED",
      claimed: 0,
      skipped: 0,
      completed: 0,
      retryScheduled: 0,
      deadLettered: 0,
      systemFailures: 0,
    });
    expect(claim).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
  });

  it("parses defaults and rejects settings outside the database claim bounds", () => {
    expect(
      breachScanOptionsFromWorkerSettings({
        ...enabledSettings,
        batchSize: undefined,
        leaseSeconds: undefined,
      }),
    ).toEqual({ now: new Date(scheduledTime), batchSize: 10, leaseSeconds: 120 });

    expect(() =>
      breachScanOptionsFromWorkerSettings({ ...enabledSettings, batchSize: "51" }),
    ).toThrow("SCAN_JOB_BATCH_SIZE_INVALID");
    expect(() =>
      breachScanOptionsFromWorkerSettings({ ...enabledSettings, leaseSeconds: "29" }),
    ).toThrow("SCAN_JOB_LEASE_SECONDS_INVALID");
    expect(() =>
      breachScanOptionsFromWorkerSettings({ ...enabledSettings, batchSize: "1e1" }),
    ).toThrow("SCAN_JOB_BATCH_SIZE_INVALID");
    expect(() =>
      breachScanOptionsFromWorkerSettings({
        ...enabledSettings,
        scheduledTime: Number.POSITIVE_INFINITY,
      }),
    ).toThrow("SCAN_JOB_NOW_INVALID");
  });

  it("processes every claim, counts terminal outcomes, and isolates one system failure", async () => {
    const jobs = Array.from({ length: 5 }, (_, index) => claimedJob(index + 1));
    const claim = vi.fn(async () => jobs);
    const process = vi.fn(async (job: ClaimedBreachScanJob, _now: Date) => {
      void _now;
      const sequence = Number(job.jobId.slice(-1));
      if (sequence === 1) return "COMPLETED" as const;
      if (sequence === 2) return "RETRY_SCHEDULED" as const;
      if (sequence === 3) throw new Error("database detail must not affect the batch");
      if (sequence === 4) return "DEAD_LETTERED" as const;
      return "SKIPPED" as const;
    });
    const reportSystemFailure = vi.fn();
    const processingTimes = jobs.map((_, index) => new Date(scheduledTime + (index + 1) * 1_000));
    let clockIndex = 0;
    const currentTime = vi.fn(() => processingTimes[clockIndex++] ?? new Date());

    await expect(
      executeBreachScanWorkerSchedule(enabledSettings, {
        claim,
        process,
        reportSystemFailure,
        currentTime,
      }),
    ).resolves.toEqual({
      status: "PROCESSED",
      claimed: 5,
      skipped: 1,
      completed: 1,
      retryScheduled: 1,
      deadLettered: 1,
      systemFailures: 1,
    });
    expect(claim).toHaveBeenCalledExactlyOnceWith({
      now: new Date(scheduledTime),
      batchSize: 10,
      leaseSeconds: 120,
    });
    expect(process).toHaveBeenCalledTimes(5);
    expect(process.mock.calls.map(([, now]) => now)).toEqual(processingTimes);
    expect(reportSystemFailure).toHaveBeenCalledExactlyOnceWith({
      jobId: jobs[2]?.jobId,
      scanId: jobs[2]?.scanId,
      error: expect.any(Error),
    });
  });

  it("propagates a claim failure because no jobs were leased to this invocation", async () => {
    const failure = new Error("claim unavailable");
    const claim = vi.fn(async () => {
      throw failure;
    });
    const process = vi.fn();

    await expect(executeBreachScanWorkerSchedule(enabledSettings, { claim, process })).rejects.toBe(
      failure,
    );
    expect(process).not.toHaveBeenCalled();
  });
});

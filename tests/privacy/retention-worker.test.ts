import {
  executeRetentionWorkerSchedule,
  retentionOptionsFromWorkerSettings,
} from "@/privacy/retention-worker-core";
import { describe, expect, it, vi } from "vitest";

const scheduledTime = new Date("2026-08-15T20:00:00.000Z").getTime();

describe("retention Worker settings", () => {
  it("parses the bounded committed settings", () => {
    expect(
      retentionOptionsFromWorkerSettings({
        scheduledTime,
        batchSize: "100",
        orphanAuditRetentionDays: "365",
      }),
    ).toEqual({
      now: new Date(scheduledTime),
      batchSize: 100,
      orphanAuditRetentionDays: 365,
    });
  });

  it.each(["", "-1", "1.5", " 1", "1e2", "0", "1001", "9007199254740992"])(
    "rejects batch size %j before database access",
    (batchSize) => {
      expect(() =>
        retentionOptionsFromWorkerSettings({
          scheduledTime,
          batchSize,
          orphanAuditRetentionDays: "365",
        }),
      ).toThrowError("RETENTION_BATCH_SIZE_INVALID");
    },
  );

  it.each(["", "-1", "1.5", " 1", "1e2", "0", "9007199254740992", "100100000"])(
    "rejects audit retention days %j before database access",
    (orphanAuditRetentionDays) => {
      expect(() =>
        retentionOptionsFromWorkerSettings({
          scheduledTime,
          batchSize: "100",
          orphanAuditRetentionDays,
        }),
      ).toThrowError("AUDIT_RETENTION_DAYS_INVALID");
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects scheduled time %j before database access",
    (invalidScheduledTime) => {
      expect(() =>
        retentionOptionsFromWorkerSettings({
          scheduledTime: invalidScheduledTime,
          batchSize: "100",
          orphanAuditRetentionDays: "365",
        }),
      ).toThrowError("RETENTION_NOW_INVALID");
    },
  );

  it("passes validated settings to the maintenance executor exactly once", async () => {
    const execute = vi.fn(async () => "completed");

    const result = await executeRetentionWorkerSchedule(
      {
        scheduledTime,
        batchSize: "100",
        orphanAuditRetentionDays: "365",
      },
      execute,
    );

    expect(execute).toHaveBeenCalledExactlyOnceWith({
      now: new Date(scheduledTime),
      batchSize: 100,
      orphanAuditRetentionDays: 365,
    });
    expect(result).toBe("completed");
  });

  it("never invokes the maintenance executor when settings are invalid", async () => {
    const execute = vi.fn(async () => "must-not-run");

    await expect(
      executeRetentionWorkerSchedule(
        {
          scheduledTime,
          batchSize: "1001",
          orphanAuditRetentionDays: "365",
        },
        execute,
      ),
    ).rejects.toThrowError("RETENTION_BATCH_SIZE_INVALID");

    expect(execute).not.toHaveBeenCalled();
  });
});

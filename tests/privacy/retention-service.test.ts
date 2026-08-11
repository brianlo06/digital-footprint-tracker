import { runRetentionMaintenance } from "@/privacy/retention-service";
import { describe, expect, it } from "vitest";

describe("retention maintenance bounds", () => {
  it("rejects unbounded or invalid batches before database access", async () => {
    await expect(runRetentionMaintenance({ batchSize: 0 })).rejects.toThrow(
      "RETENTION_BATCH_SIZE_INVALID",
    );
    await expect(runRetentionMaintenance({ batchSize: 1_001 })).rejects.toThrow(
      "RETENTION_BATCH_SIZE_INVALID",
    );
    await expect(runRetentionMaintenance({ orphanAuditRetentionDays: 0 })).rejects.toThrow(
      "AUDIT_RETENTION_DAYS_INVALID",
    );
  });
});

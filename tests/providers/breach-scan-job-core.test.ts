import {
  assertBreachScanClaimOptions,
  breachScanClaimsEnabled,
  retryDelaySeconds,
} from "@/providers/breach/breach-scan-job-core";
import { describe, expect, it } from "vitest";

describe("breach scan job core", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["true", false],
    ["TRUE", false],
    ["0", false],
    ["false", true],
  ])("treats kill-switch value %j as claims-enabled=%j", (value, enabled) => {
    expect(breachScanClaimsEnabled(value)).toBe(enabled);
  });

  it("accepts bounded claim settings", () => {
    expect(() => assertBreachScanClaimOptions({ batchSize: 1, leaseSeconds: 30 })).not.toThrow();
    expect(() => assertBreachScanClaimOptions({ batchSize: 50, leaseSeconds: 900 })).not.toThrow();
  });

  it.each([
    [{ batchSize: 0 }, "SCAN_JOB_BATCH_SIZE_INVALID"],
    [{ batchSize: 51 }, "SCAN_JOB_BATCH_SIZE_INVALID"],
    [{ leaseSeconds: 29 }, "SCAN_JOB_LEASE_SECONDS_INVALID"],
    [{ leaseSeconds: 901 }, "SCAN_JOB_LEASE_SECONDS_INVALID"],
  ])("rejects unsafe claim setting %j", (options, code) => {
    expect(() => assertBreachScanClaimOptions(options)).toThrow(code);
  });

  it("uses bounded exponential retry delays", () => {
    expect(retryDelaySeconds(1)).toBe(15);
    expect(retryDelaySeconds(2)).toBe(30);
    expect(retryDelaySeconds(3)).toBe(60);
    expect(retryDelaySeconds(20)).toBe(900);
    expect(() => retryDelaySeconds(0)).toThrow("SCAN_JOB_ATTEMPT_COUNT_INVALID");
  });
});

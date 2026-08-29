import {
  BREACH_COVERAGE_LIMITS,
  describeBreachProvider,
  isDegradedHealthOutcome,
  summarizeBreachCoverage,
} from "@/providers/breach/breach-coverage-guidance";
import type { BreachScanHistoryEntry } from "@/providers/breach/breach-scan-history";
import { selectBreachProvider } from "@/providers/provider-registry";
import { describe, expect, it } from "vitest";

function historyEntry(overrides: Partial<BreachScanHistoryEntry>): BreachScanHistoryEntry {
  return {
    scanId: "00000000-0000-4000-8000-000000000001",
    scanState: "COMPLETED",
    startedAt: new Date("2026-08-27T10:00:00Z"),
    completedAt: new Date("2026-08-27T10:00:05Z"),
    providerId: "synthetic-breach",
    providerRunState: "COMPLETED",
    providerHealthOutcome: "HEALTHY",
    errorSafeCode: null,
    findings: [],
    ...overrides,
  };
}

describe("breach coverage guidance", () => {
  it("has a reviewed presentation for every selectable provider", () => {
    const selection = selectBreachProvider({
      appEnvironment: "local",
      provider: "synthetic",
      featureEnabled: true,
      killSwitchActive: false,
    });

    expect(selection.provider).toBeDefined();
    const presentation = describeBreachProvider(selection.provider!.id);
    expect(presentation.displayName).toBe("Synthetic breach fixture provider");
    expect(presentation.description).toMatch(/fictional/i);
  });

  it("fails closed to an unreviewed presentation for an unknown provider id", () => {
    const presentation = describeBreachProvider("live-hibp");
    expect(presentation.displayName).toBe("Unreviewed provider");
    expect(presentation.attributionUrl).toBeNull();
  });

  it("states every required coverage limit", () => {
    const combined = BREACH_COVERAGE_LIMITS.join(" ");
    expect(combined).toMatch(/not proof of current account compromise/);
    expect(combined).toMatch(/not that the email is unexposed/);
    expect(combined).toMatch(/no provider catalog is comprehensive/);
    expect(combined).toMatch(/not verified are excluded/);
    expect(combined).toMatch(/exactly one verified email/);
    expect(combined).toMatch(/cannot correct the provider's source data/);
  });

  it("reports a disabled provider with no presentation or history claims", () => {
    const summary = summarizeBreachCoverage({
      selection: { status: "DISABLED" },
      recentScans: [],
    });

    expect(summary.providerEnabled).toBe(false);
    expect(summary.provider).toBeNull();
    expect(summary.lastCompletedCheckAt).toBeNull();
    expect(summary.latestScanState).toBeNull();
    expect(summary.latestHealthOutcome).toBeNull();
    expect(summary.limits).toBe(BREACH_COVERAGE_LIMITS);
  });

  it.each(["DEGRADED", "RATE_LIMITED", "UNAVAILABLE", "DISABLED"])(
    "treats %s provider health as degraded coverage",
    (healthOutcome) => {
      expect(isDegradedHealthOutcome(healthOutcome)).toBe(true);
    },
  );

  it("does not treat healthy or absent provider health as degraded", () => {
    expect(isDegradedHealthOutcome("HEALTHY")).toBe(false);
    expect(isDegradedHealthOutcome(null)).toBe(false);
  });

  it("surfaces the newest reported health and excludes a PARTIAL scan from completed checks", () => {
    const summary = summarizeBreachCoverage({
      selection: { status: "ENABLED_SYNTHETIC", provider: { id: "synthetic-breach" } },
      recentScans: [
        historyEntry({
          scanId: "00000000-0000-4000-8000-000000000003",
          scanState: "PARTIAL",
          completedAt: new Date("2026-08-27T14:00:00Z"),
          providerHealthOutcome: "RATE_LIMITED",
        }),
        historyEntry({}),
      ],
    });

    expect(summary.latestScanState).toBe("PARTIAL");
    expect(summary.latestHealthOutcome).toBe("RATE_LIMITED");
    // The PARTIAL run finished, but only the healthy COMPLETED scan counts
    // as a completed check.
    expect(summary.lastCompletedCheckAt).toEqual(new Date("2026-08-27T10:00:05Z"));
  });

  it("surfaces the newest completed check and the latest scan state plainly", () => {
    const summary = summarizeBreachCoverage({
      selection: { status: "ENABLED_SYNTHETIC", provider: { id: "synthetic-breach" } },
      recentScans: [
        historyEntry({
          scanId: "00000000-0000-4000-8000-000000000002",
          scanState: "FAILED",
          completedAt: new Date("2026-08-27T12:00:00Z"),
          errorSafeCode: "PROVIDER_TIMEOUT",
        }),
        historyEntry({}),
      ],
    });

    expect(summary.providerEnabled).toBe(true);
    expect(summary.provider?.displayName).toBe("Synthetic breach fixture provider");
    expect(summary.lastCompletedCheckAt).toEqual(new Date("2026-08-27T10:00:05Z"));
    expect(summary.latestScanState).toBe("FAILED");
  });
});

import "server-only";

import type { BreachScanHistoryEntry } from "@/providers/breach/breach-scan-history";
import type { BreachProviderSelection } from "@/providers/provider-registry";

export interface BreachProviderPresentation {
  readonly displayName: string;
  /** Required for any provider whose terms demand visible attribution; null only for local fixtures. */
  readonly attributionUrl: string | null;
  readonly description: string;
}

const PROVIDER_PRESENTATIONS: Record<string, BreachProviderPresentation> = {
  "synthetic-breach": {
    displayName: "Synthetic breach fixture provider",
    attributionUrl: null,
    description:
      "Fictional local test data only. It has no network source and no real breach catalog.",
  },
};

const UNREVIEWED_PROVIDER_PRESENTATION: BreachProviderPresentation = {
  displayName: "Unreviewed provider",
  attributionUrl: null,
  description:
    "This provider has no reviewed presentation entry and must not be trusted for display.",
};

export function describeBreachProvider(providerId: string): BreachProviderPresentation {
  return PROVIDER_PRESENTATIONS[providerId] ?? UNREVIEWED_PROVIDER_PRESENTATION;
}

export const BREACH_COVERAGE_LIMITS: readonly string[] = [
  "Each check covers exactly one verified email through the single enabled breach-metadata provider at that moment.",
  "No finding means nothing was observed through the enabled provider at check time, not that the email is unexposed.",
  "A provider-reported breach is not proof of current account compromise.",
  "Breaches the provider has not verified are excluded, and no provider catalog is comprehensive.",
  "Findings are provider-reported metadata. You can reject a finding here, but this product cannot correct the provider's source data.",
];

export interface BreachCoverageSummary {
  readonly providerEnabled: boolean;
  readonly provider: BreachProviderPresentation | null;
  readonly lastCompletedCheckAt: Date | null;
  readonly latestScanState: BreachScanHistoryEntry["scanState"] | null;
  /** Provider-reported health at the most recent run that reported any. */
  readonly latestHealthOutcome: string | null;
  readonly limits: readonly string[];
}

/** Health states in which the provider itself signalled that a check may be
 * incomplete, so the UI must not present its coverage as exhaustive. */
const DEGRADED_HEALTH_OUTCOMES = new Set(["DEGRADED", "RATE_LIMITED", "UNAVAILABLE", "DISABLED"]);

export function isDegradedHealthOutcome(healthOutcome: string | null): boolean {
  return healthOutcome !== null && DEGRADED_HEALTH_OUTCOMES.has(healthOutcome);
}

export function summarizeBreachCoverage(input: {
  readonly selection: Pick<BreachProviderSelection, "status"> & {
    readonly provider?: { readonly id: string };
  };
  readonly recentScans: readonly BreachScanHistoryEntry[];
}): BreachCoverageSummary {
  const providerEnabled = input.selection.status !== "DISABLED";
  // A PARTIAL scan finished but under degraded provider health, so it is not
  // a completed check for coverage purposes.
  const lastCompleted = input.recentScans.find(
    (scan) => scan.scanState === "COMPLETED" && scan.completedAt !== null,
  );
  const latestReportedHealth = input.recentScans.find(
    (scan) => scan.providerHealthOutcome !== null,
  );
  return {
    providerEnabled,
    provider:
      providerEnabled && input.selection.provider
        ? describeBreachProvider(input.selection.provider.id)
        : null,
    lastCompletedCheckAt: lastCompleted?.completedAt ?? null,
    latestScanState: input.recentScans[0]?.scanState ?? null,
    latestHealthOutcome: latestReportedHealth?.providerHealthOutcome ?? null,
    limits: BREACH_COVERAGE_LIMITS,
  };
}

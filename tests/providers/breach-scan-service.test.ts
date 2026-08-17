import { randomUUID } from "node:crypto";

import type { AccountContext } from "@/core/account-service";
import type { CandidateFinding } from "@/core/domain.types";
import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
} from "@/providers/breach/breach-invocation-policy";
import type { BreachInvocationAuthorizationSnapshot } from "@/providers/breach/breach-invocation-policy";
import {
  BREACH_SCAN_REQUESTED_CAPABILITY,
  executeSyntheticBreachScan,
  SYNTHETIC_BREACH_SCAN_BUDGET,
  type EligibleBreachTarget,
  type ScanRunRepository,
} from "@/providers/breach/breach-scan-service";
import { selectBreachProvider } from "@/providers/provider-registry";
import type { ProviderUsageBudget } from "@/providers/provider-usage-ledger";
import { SyntheticProviderUsageLedger } from "@/providers/synthetic-usage-ledger";
import { describe, expect, it, vi } from "vitest";

const now = new Date("2026-08-17T18:00:00.000Z");
const account: AccountContext = {
  userId: "00000000-0000-4000-8000-000000000001",
  identityId: "00000000-0000-4000-8000-000000000002",
  authSubject: "test-subject",
  authMode: "local",
};
const target: EligibleBreachTarget = {
  identifierId: "00000000-0000-4000-8000-000000000003",
  consentRecordId: "00000000-0000-4000-8000-000000000004",
};
const syntheticBudget: ProviderUsageBudget = {
  maxUserDailyRequests: 2,
  maxProviderDailyRequests: 2,
  maxProviderMonthlyRequests: 2,
  maxProviderDailyCostUnits: 0,
  maxProviderMonthlyCostUnits: 0,
};

function authorizationSnapshot(): BreachInvocationAuthorizationSnapshot {
  return {
    account: { userId: account.userId, state: "ACTIVE" },
    identity: { identityId: account.identityId, userId: account.userId, state: "ACTIVE" },
    identifier: {
      identifierId: target.identifierId,
      identityId: account.identityId,
      type: "EMAIL",
      verificationStatus: "VERIFIED",
      lastVerifiedAt: new Date(now.getTime() - 60 * 60 * 1_000),
    },
    consent: {
      consentRecordId: target.consentRecordId,
      userId: account.userId,
      identityId: account.identityId,
      purpose: BREACH_CONSENT_PURPOSE,
      policyVersion: BREACH_CONSENT_POLICY_VERSION,
      state: "GRANTED",
      dataCategories: ["EMAIL_IDENTIFIER", "BREACH_METADATA"],
      grantedAt: new Date(now.getTime() - 60 * 60 * 1_000),
      withdrawnAt: null,
    },
  };
}

function enabledSelection(
  scenario: Parameters<typeof selectBreachProvider>[0]["syntheticScenario"] = "SUCCESS",
) {
  return selectBreachProvider({
    appEnvironment: "local",
    provider: "synthetic",
    featureEnabled: true,
    killSwitchActive: false,
    syntheticScenario: scenario,
  });
}

class FakeScanRunRepository implements ScanRunRepository {
  readonly scans = new Map<string, { readonly state: string }>();
  readonly providerRuns = new Map<string, Record<string, unknown>>();
  readonly insertedFindings: {
    readonly providerRunId: string;
    readonly candidates: readonly CandidateFinding[];
  }[] = [];

  constructor(private readonly eligibleTarget: EligibleBreachTarget | null) {}

  async findEligibleTarget(): Promise<EligibleBreachTarget | null> {
    return this.eligibleTarget;
  }

  async createScan(input: {
    readonly userId: string;
    readonly identityId: string;
    readonly requestedCapability: string;
  }): Promise<string> {
    const id = randomUUID();
    this.scans.set(id, { state: "RUNNING", ...input });
    return id;
  }

  async createProviderRun(input: {
    readonly scanId: string;
    readonly userId: string;
    readonly providerId: string;
    readonly capability: string;
  }): Promise<string> {
    const id = randomUUID();
    this.providerRuns.set(id, { state: "RUNNING", ...input });
    return id;
  }

  async completeProviderRun(
    input: Parameters<ScanRunRepository["completeProviderRun"]>[0],
  ): Promise<void> {
    this.providerRuns.set(input.providerRunId, {
      ...this.providerRuns.get(input.providerRunId),
      ...input,
      state: input.outcome,
    });
  }

  async completeScan(input: {
    readonly scanId: string;
    readonly outcome: "COMPLETED" | "FAILED";
  }): Promise<void> {
    this.scans.set(input.scanId, { state: input.outcome });
  }

  async insertBreachFindings(
    input: Parameters<ScanRunRepository["insertBreachFindings"]>[0],
  ): Promise<void> {
    this.insertedFindings.push(input);
  }
}

function scanInput(overrides: Record<string, unknown> = {}) {
  return {
    account,
    now,
    providerSelection: enabledSelection(),
    repository: new FakeScanRunRepository(target),
    authorizationStore: { load: vi.fn().mockResolvedValue(authorizationSnapshot()) },
    usageLedger: new SyntheticProviderUsageLedger(),
    usageBudget: syntheticBudget,
    ...overrides,
  };
}

describe("synthetic breach scan service", () => {
  it("keeps the exported synthetic scan budget's cost limits at zero", () => {
    expect(SYNTHETIC_BREACH_SCAN_BUDGET.maxProviderDailyCostUnits).toBe(0);
    expect(SYNTHETIC_BREACH_SCAN_BUDGET.maxProviderMonthlyCostUnits).toBe(0);
    expect(SYNTHETIC_BREACH_SCAN_BUDGET.maxUserDailyRequests).toBeGreaterThan(0);
  });

  it("returns PROVIDER_DISABLED without touching the repository", async () => {
    const repository = new FakeScanRunRepository(target);
    const findEligibleTarget = vi.spyOn(repository, "findEligibleTarget");

    await expect(
      executeSyntheticBreachScan(
        scanInput({
          repository,
          providerSelection: selectBreachProvider({
            appEnvironment: "local",
            provider: "disabled",
            featureEnabled: false,
            killSwitchActive: true,
          }),
        }),
      ),
    ).resolves.toEqual({ status: "PROVIDER_DISABLED" });
    expect(findEligibleTarget).not.toHaveBeenCalled();
    expect(repository.scans.size).toBe(0);
  });

  it("returns NO_ELIGIBLE_TARGET without creating a scan row", async () => {
    const repository = new FakeScanRunRepository(null);

    await expect(executeSyntheticBreachScan(scanInput({ repository }))).resolves.toEqual({
      status: "NO_ELIGIBLE_TARGET",
    });
    expect(repository.scans.size).toBe(0);
  });

  it("persists normalized findings and completes both rows on success", async () => {
    const repository = new FakeScanRunRepository(target);

    const result = await executeSyntheticBreachScan(scanInput({ repository }));

    expect(result).toMatchObject({ status: "COMPLETED", findingCount: 1 });
    expect(repository.insertedFindings).toHaveLength(1);
    const [insertedCall] = repository.insertedFindings;
    expect(insertedCall.candidates[0]).toMatchObject({
      type: "BREACH",
      title: "Synthetic Commerce",
      evidence: [
        expect.objectContaining({
          sourceDate: "2024-01-15",
          dataCategories: ["Email addresses", "Names"],
          isVerified: true,
          isSensitive: false,
          isRetired: false,
        }),
      ],
    });
    if (result.status !== "COMPLETED") throw new Error("expected COMPLETED result");
    expect(repository.scans.get(result.scanId)).toMatchObject({ state: "COMPLETED" });
    expect(repository.providerRuns.get(result.providerRunId)).toMatchObject({
      state: "COMPLETED",
      resultCount: 1,
      capability: BREACH_SCAN_REQUESTED_CAPABILITY,
    });
  });

  it("marks both rows FAILED with the denial reason and inserts no findings when denied", async () => {
    const repository = new FakeScanRunRepository(target);

    const result = await executeSyntheticBreachScan(
      scanInput({ repository, authorizationStore: { load: vi.fn().mockResolvedValue(null) } }),
    );

    expect(result).toMatchObject({ status: "DENIED", reason: "RESOURCE_NOT_AVAILABLE" });
    expect(repository.insertedFindings).toHaveLength(0);
    if (result.status !== "DENIED") throw new Error("expected DENIED result");
    expect(repository.scans.get(result.scanId)).toMatchObject({ state: "FAILED" });
    expect(repository.providerRuns.get(result.providerRunId)).toMatchObject({
      state: "FAILED",
      errorSafeCode: "RESOURCE_NOT_AVAILABLE",
    });
  });

  it("marks both rows FAILED with the provider's safe code and rethrows on a dispatch failure", async () => {
    const repository = new FakeScanRunRepository(target);

    await expect(
      executeSyntheticBreachScan(
        scanInput({ repository, providerSelection: enabledSelection("RATE_LIMIT") }),
      ),
    ).rejects.toMatchObject({ descriptor: { safeCode: "PROVIDER_RATE_LIMITED" } });

    const [providerRun] = [...repository.providerRuns.values()];
    expect(providerRun).toMatchObject({ state: "FAILED", errorSafeCode: "PROVIDER_RATE_LIMITED" });
    const [scan] = [...repository.scans.values()];
    expect(scan).toMatchObject({ state: "FAILED" });
  });
});

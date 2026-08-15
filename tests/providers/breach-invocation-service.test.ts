import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
  type BreachInvocationAuthorizationSnapshot,
} from "@/providers/breach/breach-invocation-policy";
import { executeSyntheticBreachInvocation } from "@/providers/breach/breach-invocation-service";
import { selectBreachProvider } from "@/providers/provider-registry";
import type { ProviderUsageBudget } from "@/providers/provider-usage-ledger";
import { SyntheticProviderUsageLedger } from "@/providers/synthetic-usage-ledger";
import { afterEach, describe, expect, it, vi } from "vitest";

const now = new Date("2026-08-15T18:00:00.000Z");
const command = {
  userId: "00000000-0000-4000-8000-000000000001",
  identityId: "00000000-0000-4000-8000-000000000002",
  identifierId: "00000000-0000-4000-8000-000000000003",
  consentRecordId: "00000000-0000-4000-8000-000000000004",
  scanId: "00000000-0000-4000-8000-000000000005",
  providerRunId: "00000000-0000-4000-8000-000000000006",
  idempotencyKey: "synthetic:invoke:0001",
  deadline: "2099-01-01T00:00:00.000Z",
  maxResults: 10,
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
    account: { userId: command.userId, state: "ACTIVE" },
    identity: {
      identityId: command.identityId,
      userId: command.userId,
      state: "ACTIVE",
    },
    identifier: {
      identifierId: command.identifierId,
      identityId: command.identityId,
      type: "EMAIL",
      verificationStatus: "VERIFIED",
      lastVerifiedAt: new Date(now.getTime() - 60 * 60 * 1_000),
    },
    consent: {
      consentRecordId: command.consentRecordId,
      userId: command.userId,
      identityId: command.identityId,
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

function invocationInput(overrides = {}) {
  return {
    command,
    now,
    providerSelection: enabledSelection(),
    authorizationStore: { load: vi.fn().mockResolvedValue(authorizationSnapshot()) },
    usageLedger: new SyntheticProviderUsageLedger(),
    usageBudget: syntheticBudget,
    ...overrides,
  };
}

describe("synthetic breach invocation service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authorizes, reserves, invokes, normalizes, and reconciles without network access", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const usageLedger = new SyntheticProviderUsageLedger();

    await expect(
      executeSyntheticBreachInvocation(invocationInput({ usageLedger })),
    ).resolves.toEqual({
      status: "COMPLETED",
      reservationId: expect.any(String),
      candidates: [expect.objectContaining({ type: "BREACH", title: "Synthetic Commerce" })],
      hasMore: false,
    });
    expect(usageLedger.snapshot()).toEqual([
      expect.objectContaining({ state: "COMPLETED", actualCostUnits: 0 }),
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed when no explicit usage budget is supplied", async () => {
    const input = invocationInput();
    delete (input as Partial<typeof input>).usageBudget;

    await expect(executeSyntheticBreachInvocation(input)).resolves.toEqual({
      status: "DENIED",
      reason: "USER_DAILY_REQUEST_LIMIT",
    });
    expect(input.usageLedger.snapshot()).toEqual([]);
  });

  it("denies a disabled selection before loading sensitive authorization state", async () => {
    const authorizationStore = { load: vi.fn() };

    await expect(
      executeSyntheticBreachInvocation(
        invocationInput({
          providerSelection: selectBreachProvider({
            appEnvironment: "local",
            provider: "disabled",
            featureEnabled: false,
            killSwitchActive: true,
          }),
          authorizationStore,
        }),
      ),
    ).resolves.toEqual({ status: "DENIED", reason: "PROVIDER_DISABLED" });
    expect(authorizationStore.load).not.toHaveBeenCalled();
  });

  it("denies stale verification before creating a reservation", async () => {
    const snapshotBase = authorizationSnapshot();
    const snapshot: BreachInvocationAuthorizationSnapshot = {
      ...snapshotBase,
      identifier: {
        ...snapshotBase.identifier,
        lastVerifiedAt: new Date("2026-08-14T17:59:59.999Z"),
      },
    };
    const usageLedger = new SyntheticProviderUsageLedger();

    await expect(
      executeSyntheticBreachInvocation(
        invocationInput({
          authorizationStore: { load: vi.fn().mockResolvedValue(snapshot) },
          usageLedger,
        }),
      ),
    ).resolves.toEqual({ status: "DENIED", reason: "VERIFICATION_STALE" });
    expect(usageLedger.snapshot()).toEqual([]);
  });

  it("returns in progress for a concurrent duplicate without a second dispatch", async () => {
    const selection = enabledSelection();
    if (!selection.provider) throw new Error("expected synthetic provider");
    const provider = selection.provider;
    let signalEntered: () => void = () => undefined;
    let releaseScan: () => void = () => undefined;
    const enteredScan = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const scanGate = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    const scan = vi.fn(async (...args: Parameters<typeof provider.scan>) => {
      signalEntered();
      await scanGate;
      return provider.scan(...args);
    });
    const usageLedger = new SyntheticProviderUsageLedger();
    const input = invocationInput({
      usageLedger,
      providerSelection: { ...selection, provider: { ...provider, scan } },
    });

    const firstPromise = executeSyntheticBreachInvocation(input);
    await enteredScan;
    await expect(executeSyntheticBreachInvocation(input)).resolves.toMatchObject({
      status: "IN_PROGRESS",
    });
    releaseScan();
    await expect(firstPromise).resolves.toMatchObject({ status: "COMPLETED" });
    expect(scan).toHaveBeenCalledOnce();
  });

  it("does not invoke the provider twice for a completed idempotency key", async () => {
    const usageLedger = new SyntheticProviderUsageLedger();
    const input = invocationInput({ usageLedger });
    const first = await executeSyntheticBreachInvocation(input);
    const second = await executeSyntheticBreachInvocation(input);

    expect(first).toMatchObject({ status: "COMPLETED" });
    expect(second).toMatchObject({
      status: "ALREADY_PROCESSED",
      reservationId: first.status === "COMPLETED" ? first.reservationId : "unexpected-first-result",
    });
    expect(usageLedger.snapshot()).toHaveLength(1);
  });

  it("records a dispatched provider failure so an idempotent retry cannot dispatch again", async () => {
    const usageLedger = new SyntheticProviderUsageLedger();
    const input = invocationInput({
      usageLedger,
      providerSelection: enabledSelection("RATE_LIMIT"),
    });

    await expect(executeSyntheticBreachInvocation(input)).rejects.toMatchObject({
      descriptor: { kind: "RATE_LIMIT", safeCode: "PROVIDER_RATE_LIMITED" },
    });
    expect(usageLedger.snapshot()).toEqual([
      expect.objectContaining({ state: "FAILED", actualCostUnits: 0 }),
    ]);
    await expect(executeSyntheticBreachInvocation(input)).resolves.toMatchObject({
      status: "ALREADY_PROCESSED",
    });
    expect(usageLedger.snapshot()).toHaveLength(1);
  });

  it("surfaces bounded pagination without automatically requesting another page", async () => {
    await expect(
      executeSyntheticBreachInvocation(
        invocationInput({ providerSelection: enabledSelection("PAGINATED") }),
      ),
    ).resolves.toMatchObject({ status: "COMPLETED", hasMore: true });
  });

  it("rejects an expired deadline or invalid invocation clock before side effects", async () => {
    await expect(
      executeSyntheticBreachInvocation(
        invocationInput({ command: { ...command, deadline: now.toISOString() } }),
      ),
    ).rejects.toThrowError("PROVIDER_INVOCATION_DEADLINE_EXPIRED");
    await expect(
      executeSyntheticBreachInvocation(invocationInput({ now: "not-a-date" as unknown as Date })),
    ).rejects.toThrowError("PROVIDER_INVOCATION_COMMAND_INVALID");
  });
});

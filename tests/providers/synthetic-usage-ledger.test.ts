import type { ProviderUsageBudget } from "@/providers/provider-usage-ledger";
import { SyntheticProviderUsageLedger } from "@/providers/synthetic-usage-ledger";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-15T18:00:00.000Z");
const userId = "00000000-0000-4000-8000-000000000001";
const budget: ProviderUsageBudget = {
  maxUserDailyRequests: 2,
  maxProviderDailyRequests: 3,
  maxProviderMonthlyRequests: 4,
  maxProviderDailyCostUnits: 5,
  maxProviderMonthlyCostUnits: 8,
};

function reservationInput(sequence: number, overrides = {}) {
  return {
    idempotencyKey: `synthetic:usage:${sequence.toString().padStart(4, "0")}`,
    requestFingerprint: `synthetic:request:${sequence.toString().padStart(4, "0")}`,
    userId,
    providerId: "synthetic-breach",
    estimatedCostUnits: 0,
    now,
    ...overrides,
  };
}

describe("synthetic provider usage ledger", () => {
  it("fails closed with a zero request and cost budget by default", async () => {
    const ledger = new SyntheticProviderUsageLedger();

    await expect(ledger.reserve(reservationInput(1))).resolves.toEqual({
      status: "DENIED",
      reason: "USER_DAILY_REQUEST_LIMIT",
    });
    expect(ledger.snapshot()).toEqual([]);
  });

  it("reserves atomically and returns the existing reservation for an idempotent retry", async () => {
    const ledger = new SyntheticProviderUsageLedger();
    const [first, second] = await Promise.all([
      ledger.reserve(reservationInput(1), budget),
      ledger.reserve(reservationInput(1), budget),
    ]);

    expect(first.status).toBe("RESERVED");
    expect(second.status).toBe("EXISTING");
    if (first.status !== "RESERVED" || second.status !== "EXISTING") return;
    expect(second.reservation.reservationId).toBe(first.reservation.reservationId);
    expect(ledger.snapshot()).toHaveLength(1);
  });

  it("rejects reuse of an idempotency key for different bound inputs", async () => {
    const ledger = new SyntheticProviderUsageLedger();
    await ledger.reserve(reservationInput(1), budget);

    await expect(
      ledger.reserve(
        reservationInput(1, {
          requestFingerprint: "synthetic:request:different",
        }),
        budget,
      ),
    ).resolves.toEqual({ status: "DENIED", reason: "IDEMPOTENCY_CONFLICT" });
  });

  it("enforces user and provider request limits while failed attempts still count", async () => {
    const ledger = new SyntheticProviderUsageLedger();
    const first = await ledger.reserve(reservationInput(1), budget);
    if (first.status !== "RESERVED") throw new Error("expected reservation");
    await ledger.complete(first.reservation.reservationId, "FAILED", 0);
    await ledger.reserve(reservationInput(2), budget);

    await expect(ledger.reserve(reservationInput(3), budget)).resolves.toEqual({
      status: "DENIED",
      reason: "USER_DAILY_REQUEST_LIMIT",
    });

    const otherUserBudget = { ...budget, maxUserDailyRequests: 10 };
    await ledger.reserve(
      reservationInput(3, { userId: "00000000-0000-4000-8000-000000000002" }),
      otherUserBudget,
    );
    await expect(
      ledger.reserve(
        reservationInput(4, { userId: "00000000-0000-4000-8000-000000000003" }),
        otherUserBudget,
      ),
    ).resolves.toEqual({ status: "DENIED", reason: "PROVIDER_DAILY_REQUEST_LIMIT" });
  });

  it("releases an undispatched reservation so its budget can be reused", async () => {
    const ledger = new SyntheticProviderUsageLedger();
    const oneRequest = {
      ...budget,
      maxUserDailyRequests: 1,
      maxProviderDailyRequests: 1,
      maxProviderMonthlyRequests: 1,
    };
    const first = await ledger.reserve(reservationInput(1), oneRequest);
    if (first.status !== "RESERVED") throw new Error("expected reservation");
    await ledger.release(first.reservation.reservationId);

    await expect(ledger.reserve(reservationInput(2), oneRequest)).resolves.toMatchObject({
      status: "RESERVED",
    });
  });

  it("enforces daily and monthly cost reservations before dispatch", async () => {
    const ledger = new SyntheticProviderUsageLedger();
    await ledger.reserve(reservationInput(1, { estimatedCostUnits: 4 }), budget);

    await expect(
      ledger.reserve(reservationInput(2, { estimatedCostUnits: 2 }), budget),
    ).resolves.toEqual({ status: "DENIED", reason: "PROVIDER_DAILY_COST_LIMIT" });

    const nextDay = new Date("2026-08-16T18:00:00.000Z");
    await ledger.reserve(reservationInput(2, { estimatedCostUnits: 4, now: nextDay }), budget);
    await expect(
      ledger.reserve(
        reservationInput(3, {
          estimatedCostUnits: 1,
          now: new Date("2026-08-17T18:00:00.000Z"),
        }),
        budget,
      ),
    ).resolves.toEqual({ status: "DENIED", reason: "PROVIDER_MONTHLY_COST_LIMIT" });
  });

  it("validates completion costs and terminal-state idempotency", async () => {
    const ledger = new SyntheticProviderUsageLedger();
    const reserved = await ledger.reserve(reservationInput(1, { estimatedCostUnits: 2 }), budget);
    if (reserved.status !== "RESERVED") throw new Error("expected reservation");

    await expect(
      ledger.complete(reserved.reservation.reservationId, "COMPLETED", 3),
    ).rejects.toThrowError("PROVIDER_USAGE_ACTUAL_COST_EXCEEDS_RESERVATION");
    await expect(
      ledger.complete(reserved.reservation.reservationId, "COMPLETED", 1),
    ).resolves.toMatchObject({ state: "COMPLETED", actualCostUnits: 1 });
    await expect(
      ledger.complete(reserved.reservation.reservationId, "COMPLETED", 1),
    ).resolves.toMatchObject({ state: "COMPLETED", actualCostUnits: 1 });
    await expect(
      ledger.complete(reserved.reservation.reservationId, "FAILED", 0),
    ).rejects.toThrowError("PROVIDER_USAGE_COMPLETION_CONFLICT");
  });

  it("rejects invalid clocks without mutating state", async () => {
    const ledger = new SyntheticProviderUsageLedger();

    await expect(
      ledger.reserve(reservationInput(1, { now: new Date("invalid") }), budget),
    ).rejects.toThrowError("PROVIDER_USAGE_RESERVATION_INVALID");
    expect(ledger.snapshot()).toEqual([]);
  });
});

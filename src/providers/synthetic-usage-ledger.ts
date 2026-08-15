import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

export interface ProviderUsageBudget {
  readonly maxUserDailyRequests: number;
  readonly maxProviderDailyRequests: number;
  readonly maxProviderMonthlyRequests: number;
  readonly maxProviderDailyCostUnits: number;
  readonly maxProviderMonthlyCostUnits: number;
}

export const ZERO_PROVIDER_USAGE_BUDGET: ProviderUsageBudget = Object.freeze({
  maxUserDailyRequests: 0,
  maxProviderDailyRequests: 0,
  maxProviderMonthlyRequests: 0,
  maxProviderDailyCostUnits: 0,
  maxProviderMonthlyCostUnits: 0,
});

const reservationInputSchema = z.strictObject({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/),
  requestFingerprint: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{15,511}$/),
  userId: z.uuid(),
  providerId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  estimatedCostUnits: z.number().int().nonnegative(),
  now: z.date(),
});

const budgetSchema = z.strictObject({
  maxUserDailyRequests: z.number().int().nonnegative(),
  maxProviderDailyRequests: z.number().int().nonnegative(),
  maxProviderMonthlyRequests: z.number().int().nonnegative(),
  maxProviderDailyCostUnits: z.number().int().nonnegative(),
  maxProviderMonthlyCostUnits: z.number().int().nonnegative(),
});

export interface ProviderUsageReservationInput {
  readonly idempotencyKey: string;
  /** Opaque IDs only; never include an identifier value or provider response. */
  readonly requestFingerprint: string;
  readonly userId: string;
  readonly providerId: string;
  readonly estimatedCostUnits: number;
  readonly now: Date;
}

export type ProviderUsageReservationState = "RESERVED" | "COMPLETED" | "FAILED" | "RELEASED";

export interface ProviderUsageReservation extends ProviderUsageReservationInput {
  readonly reservationId: string;
  readonly state: ProviderUsageReservationState;
  readonly actualCostUnits?: number;
}

export type ProviderUsageDenialReason =
  | "IDEMPOTENCY_CONFLICT"
  | "USER_DAILY_REQUEST_LIMIT"
  | "PROVIDER_DAILY_REQUEST_LIMIT"
  | "PROVIDER_MONTHLY_REQUEST_LIMIT"
  | "PROVIDER_DAILY_COST_LIMIT"
  | "PROVIDER_MONTHLY_COST_LIMIT";

export type ReserveProviderUsageResult =
  | {
      readonly status: "RESERVED" | "EXISTING";
      readonly reservation: ProviderUsageReservation;
    }
  | { readonly status: "DENIED"; readonly reason: ProviderUsageDenialReason };

export interface ProviderUsageLedger {
  reserve(
    input: ProviderUsageReservationInput,
    budget?: ProviderUsageBudget,
  ): Promise<ReserveProviderUsageResult>;
  complete(
    reservationId: string,
    outcome: "COMPLETED" | "FAILED",
    actualCostUnits: number,
  ): Promise<ProviderUsageReservation>;
  release(reservationId: string): Promise<ProviderUsageReservation>;
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function utcMonth(value: Date): string {
  return value.toISOString().slice(0, 7);
}

function countsAgainstBudget(reservation: ProviderUsageReservation): boolean {
  return reservation.state !== "RELEASED";
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function copyReservation(reservation: ProviderUsageReservation): ProviderUsageReservation {
  return { ...reservation, now: new Date(reservation.now) };
}

/**
 * Single-process ledger for the approved local synthetic slice. Its contract is
 * persistence-neutral, but this implementation is deliberately not suitable
 * for distributed or hosted execution.
 */
export class SyntheticProviderUsageLedger implements ProviderUsageLedger {
  private readonly reservations = new Map<string, ProviderUsageReservation>();
  private readonly reservationIdsByIdempotencyKey = new Map<string, string>();

  async reserve(
    input: ProviderUsageReservationInput,
    budget: ProviderUsageBudget = ZERO_PROVIDER_USAGE_BUDGET,
  ): Promise<ReserveProviderUsageResult> {
    const parsedInput = reservationInputSchema.safeParse(input);
    if (!parsedInput.success || !validDate(input.now)) {
      throw new Error("PROVIDER_USAGE_RESERVATION_INVALID");
    }
    if (!budgetSchema.safeParse(budget).success) {
      throw new Error("PROVIDER_USAGE_BUDGET_INVALID");
    }

    const existingId = this.reservationIdsByIdempotencyKey.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.reservations.get(existingId);
      if (!existing) throw new Error("PROVIDER_USAGE_LEDGER_CORRUPT");
      if (
        existing.userId !== input.userId ||
        existing.providerId !== input.providerId ||
        existing.requestFingerprint !== input.requestFingerprint ||
        existing.estimatedCostUnits !== input.estimatedCostUnits
      ) {
        return { status: "DENIED", reason: "IDEMPOTENCY_CONFLICT" };
      }
      return { status: "EXISTING", reservation: copyReservation(existing) };
    }

    const active = [...this.reservations.values()].filter(countsAgainstBudget);
    const day = utcDay(input.now);
    const month = utcMonth(input.now);
    const providerDaily = active.filter(
      (item) => item.providerId === input.providerId && utcDay(item.now) === day,
    );
    const providerMonthly = active.filter(
      (item) => item.providerId === input.providerId && utcMonth(item.now) === month,
    );
    const userDaily = providerDaily.filter((item) => item.userId === input.userId);
    if (userDaily.length + 1 > budget.maxUserDailyRequests) {
      return { status: "DENIED", reason: "USER_DAILY_REQUEST_LIMIT" };
    }
    if (providerDaily.length + 1 > budget.maxProviderDailyRequests) {
      return { status: "DENIED", reason: "PROVIDER_DAILY_REQUEST_LIMIT" };
    }
    if (providerMonthly.length + 1 > budget.maxProviderMonthlyRequests) {
      return { status: "DENIED", reason: "PROVIDER_MONTHLY_REQUEST_LIMIT" };
    }

    const dailyCost = providerDaily.reduce((total, item) => total + item.estimatedCostUnits, 0);
    if (dailyCost + input.estimatedCostUnits > budget.maxProviderDailyCostUnits) {
      return { status: "DENIED", reason: "PROVIDER_DAILY_COST_LIMIT" };
    }
    const monthlyCost = providerMonthly.reduce((total, item) => total + item.estimatedCostUnits, 0);
    if (monthlyCost + input.estimatedCostUnits > budget.maxProviderMonthlyCostUnits) {
      return { status: "DENIED", reason: "PROVIDER_MONTHLY_COST_LIMIT" };
    }

    const reservation: ProviderUsageReservation = {
      ...parsedInput.data,
      reservationId: randomUUID(),
      state: "RESERVED",
    };
    this.reservations.set(reservation.reservationId, reservation);
    this.reservationIdsByIdempotencyKey.set(reservation.idempotencyKey, reservation.reservationId);
    return { status: "RESERVED", reservation: copyReservation(reservation) };
  }

  async complete(
    reservationId: string,
    outcome: "COMPLETED" | "FAILED",
    actualCostUnits: number,
  ): Promise<ProviderUsageReservation> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error("PROVIDER_USAGE_RESERVATION_NOT_FOUND");
    if (!Number.isSafeInteger(actualCostUnits) || actualCostUnits < 0) {
      throw new Error("PROVIDER_USAGE_ACTUAL_COST_INVALID");
    }
    if (actualCostUnits > reservation.estimatedCostUnits) {
      throw new Error("PROVIDER_USAGE_ACTUAL_COST_EXCEEDS_RESERVATION");
    }
    if (reservation.state === "RELEASED") throw new Error("PROVIDER_USAGE_ALREADY_RELEASED");
    if (reservation.state !== "RESERVED") {
      if (reservation.state !== outcome || reservation.actualCostUnits !== actualCostUnits) {
        throw new Error("PROVIDER_USAGE_COMPLETION_CONFLICT");
      }
      return copyReservation(reservation);
    }

    const completed = { ...reservation, state: outcome, actualCostUnits } as const;
    this.reservations.set(reservationId, completed);
    return copyReservation(completed);
  }

  async release(reservationId: string): Promise<ProviderUsageReservation> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error("PROVIDER_USAGE_RESERVATION_NOT_FOUND");
    if (reservation.state === "RELEASED") return copyReservation(reservation);
    if (reservation.state !== "RESERVED") throw new Error("PROVIDER_USAGE_ALREADY_COMPLETED");

    const released = { ...reservation, state: "RELEASED" as const };
    this.reservations.set(reservationId, released);
    return copyReservation(released);
  }

  snapshot(): readonly ProviderUsageReservation[] {
    return [...this.reservations.values()].map(copyReservation);
  }
}

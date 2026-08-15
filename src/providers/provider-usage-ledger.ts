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

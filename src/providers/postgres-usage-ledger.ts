import "server-only";

import type { DatabaseTransaction } from "@/database/client";
import {
  type ProviderUsageBudget,
  type ProviderUsageDenialReason,
  type ProviderUsageLedger,
  type ProviderUsageReservation,
  type ProviderUsageReservationInput,
  type ProviderUsageReservationState,
  type ReserveProviderUsageResult,
  ZERO_PROVIDER_USAGE_BUDGET,
} from "@/providers/provider-usage-ledger";
import { sql } from "drizzle-orm";
import { z } from "zod";

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

interface UsageRow {
  readonly status?: "RESERVED" | "EXISTING" | "DENIED";
  readonly reason?: ProviderUsageDenialReason | null;
  readonly reservationId: string | null;
  readonly userId: string | null;
  readonly providerId: string | null;
  readonly idempotencyKey: string | null;
  readonly requestFingerprint: string | null;
  readonly estimatedCostUnits: number | null;
  readonly actualCostUnits: number | null;
  readonly state: ProviderUsageReservationState | null;
  readonly reservedAt: Date | string | null;
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function dateFromRow(value: Date | string | null): Date | null {
  if (validDate(value)) return new Date(value);
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return validDate(parsed) ? parsed : null;
}

function reservationFromRow(row: UsageRow): ProviderUsageReservation {
  const reservedAt = dateFromRow(row.reservedAt);
  if (
    !row.reservationId ||
    !row.userId ||
    !row.providerId ||
    !row.idempotencyKey ||
    !row.requestFingerprint ||
    row.estimatedCostUnits === null ||
    !row.state ||
    !reservedAt
  ) {
    throw new Error("PROVIDER_USAGE_DECISION_INVALID");
  }
  return {
    reservationId: row.reservationId,
    userId: row.userId,
    providerId: row.providerId,
    idempotencyKey: row.idempotencyKey,
    requestFingerprint: row.requestFingerprint,
    estimatedCostUnits: row.estimatedCostUnits,
    ...(row.actualCostUnits === null ? {} : { actualCostUnits: row.actualCostUnits }),
    state: row.state,
    now: reservedAt,
  };
}

function firstRow(rows: unknown): UsageRow {
  const [row] = rows as UsageRow[];
  if (!row) throw new Error("PROVIDER_USAGE_DECISION_MISSING");
  return row;
}

/** Durable implementation; quota calculations and transitions are atomic in PostgreSQL. */
export class PostgresProviderUsageLedger implements ProviderUsageLedger {
  constructor(private readonly transaction: DatabaseTransaction) {}

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

    const rows = await this.transaction.execute(sql<UsageRow>`
      select
        result_status as status,
        denial_reason as reason,
        reservation_id as "reservationId",
        reservation_user_id as "userId",
        reservation_provider_id as "providerId",
        reservation_idempotency_key as "idempotencyKey",
        reservation_request_fingerprint as "requestFingerprint",
        reservation_estimated_cost_units as "estimatedCostUnits",
        reservation_actual_cost_units as "actualCostUnits",
        reservation_state as state,
        reservation_reserved_at as "reservedAt"
      from public.reserve_provider_usage(
        ${input.userId}::uuid,
        ${input.providerId},
        ${input.idempotencyKey},
        ${input.requestFingerprint},
        ${input.estimatedCostUnits},
        ${budget.maxUserDailyRequests},
        ${budget.maxProviderDailyRequests},
        ${budget.maxProviderMonthlyRequests},
        ${budget.maxProviderDailyCostUnits},
        ${budget.maxProviderMonthlyCostUnits}
      )
    `);
    const row = firstRow(rows);
    if (row.status === "DENIED") {
      if (!row.reason) throw new Error("PROVIDER_USAGE_DECISION_INVALID");
      return { status: "DENIED", reason: row.reason };
    }
    if (row.status !== "RESERVED" && row.status !== "EXISTING") {
      throw new Error("PROVIDER_USAGE_DECISION_INVALID");
    }
    return { status: row.status, reservation: reservationFromRow(row) };
  }

  async complete(
    reservationId: string,
    outcome: "COMPLETED" | "FAILED",
    actualCostUnits: number,
  ): Promise<ProviderUsageReservation> {
    const rows = await this.transaction.execute(sql<UsageRow>`
      select
        reservation_id as "reservationId",
        reservation_user_id as "userId",
        reservation_provider_id as "providerId",
        reservation_idempotency_key as "idempotencyKey",
        reservation_request_fingerprint as "requestFingerprint",
        reservation_estimated_cost_units as "estimatedCostUnits",
        reservation_actual_cost_units as "actualCostUnits",
        reservation_state as state,
        reservation_reserved_at as "reservedAt"
      from public.complete_provider_usage(
        ${reservationId}::uuid,
        ${outcome}::public.provider_usage_state,
        ${actualCostUnits}
      )
    `);
    return reservationFromRow(firstRow(rows));
  }

  async release(reservationId: string): Promise<ProviderUsageReservation> {
    const rows = await this.transaction.execute(sql<UsageRow>`
      select
        reservation_id as "reservationId",
        reservation_user_id as "userId",
        reservation_provider_id as "providerId",
        reservation_idempotency_key as "idempotencyKey",
        reservation_request_fingerprint as "requestFingerprint",
        reservation_estimated_cost_units as "estimatedCostUnits",
        reservation_actual_cost_units as "actualCostUnits",
        reservation_state as state,
        reservation_reserved_at as "reservedAt"
      from public.release_provider_usage(${reservationId}::uuid)
    `);
    return reservationFromRow(firstRow(rows));
  }
}

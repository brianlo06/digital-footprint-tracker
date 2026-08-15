import "server-only";

import { z } from "zod";

import {
  evaluateBreachInvocationAuthorization,
  type BreachInvocationAuthorizationSnapshot,
  type BreachInvocationDenialReason,
} from "@/providers/breach/breach-invocation-policy";
import type { BreachProviderSelection } from "@/providers/provider-registry";
import type {
  ProviderUsageBudget,
  ProviderUsageDenialReason,
  ProviderUsageLedger,
} from "@/providers/synthetic-usage-ledger";
import type { CandidateFinding } from "@/core/domain.types";

const invocationCommandSchema = z.strictObject({
  userId: z.uuid(),
  identityId: z.uuid(),
  identifierId: z.uuid(),
  consentRecordId: z.uuid(),
  scanId: z.uuid(),
  providerRunId: z.uuid(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/),
  deadline: z.iso.datetime({ offset: true }),
  maxResults: z.number().int().min(1).max(10),
});

export type SyntheticBreachInvocationCommand = z.infer<typeof invocationCommandSchema>;

export interface BreachInvocationAuthorizationStore {
  load(
    command: SyntheticBreachInvocationCommand,
  ): Promise<BreachInvocationAuthorizationSnapshot | null>;
}

export type SyntheticBreachInvocationDenialReason =
  | BreachInvocationDenialReason
  | ProviderUsageDenialReason
  | "PROVIDER_DISABLED"
  | "PROVIDER_CAPABILITY_UNAVAILABLE";

export type SyntheticBreachInvocationResult =
  | {
      readonly status: "COMPLETED";
      readonly reservationId: string;
      readonly candidates: readonly CandidateFinding[];
      readonly hasMore: boolean;
    }
  | {
      readonly status: "IN_PROGRESS" | "ALREADY_PROCESSED";
      readonly reservationId: string;
    }
  | { readonly status: "DENIED"; readonly reason: SyntheticBreachInvocationDenialReason };

export async function executeSyntheticBreachInvocation(input: {
  readonly command: SyntheticBreachInvocationCommand;
  readonly now: Date;
  readonly providerSelection: BreachProviderSelection;
  readonly authorizationStore: BreachInvocationAuthorizationStore;
  readonly usageLedger: ProviderUsageLedger;
  readonly usageBudget?: ProviderUsageBudget;
}): Promise<SyntheticBreachInvocationResult> {
  const parsedCommand = invocationCommandSchema.safeParse(input.command);
  if (
    !parsedCommand.success ||
    !(input.now instanceof Date) ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new Error("PROVIDER_INVOCATION_COMMAND_INVALID");
  }
  const command = parsedCommand.data;
  if (Date.parse(command.deadline) <= input.now.getTime()) {
    throw new Error("PROVIDER_INVOCATION_DEADLINE_EXPIRED");
  }

  const provider = input.providerSelection.provider;
  if (input.providerSelection.status !== "ENABLED_SYNTHETIC" || !provider) {
    return { status: "DENIED", reason: "PROVIDER_DISABLED" };
  }

  const snapshot = await input.authorizationStore.load(command);
  const authorizationDenial = evaluateBreachInvocationAuthorization(command, snapshot, input.now);
  if (authorizationDenial) return { status: "DENIED", reason: authorizationDenial };

  const providerReference = {
    identifierId: command.identifierId,
    identifierType: "EMAIL" as const,
    verificationScope: "VERIFIED_EMAIL_SELF" as const,
  };
  if (!provider.supports(providerReference, "BREACH_METADATA_BY_VERIFIED_EMAIL")) {
    return { status: "DENIED", reason: "PROVIDER_CAPABILITY_UNAVAILABLE" };
  }
  const providerInput = await provider.validate(providerReference);
  const estimatedCostUnits = await provider.estimateCost(providerInput);
  const requestFingerprint = [
    command.identityId,
    command.identifierId,
    command.consentRecordId,
    command.scanId,
    command.providerRunId,
  ].join(":");
  const reserved = await input.usageLedger.reserve(
    {
      idempotencyKey: command.idempotencyKey,
      requestFingerprint,
      userId: command.userId,
      providerId: provider.id,
      estimatedCostUnits,
      now: input.now,
    },
    input.usageBudget,
  );
  if (reserved.status === "DENIED") return { status: "DENIED", reason: reserved.reason };
  if (reserved.status === "EXISTING") {
    return {
      status: reserved.reservation.state === "RESERVED" ? "IN_PROGRESS" : "ALREADY_PROCESSED",
      reservationId: reserved.reservation.reservationId,
    };
  }

  const reservationId = reserved.reservation.reservationId;
  try {
    const page = await provider.scan(
      {
        scanId: command.scanId,
        providerRunId: command.providerRunId,
        consentRecordId: command.consentRecordId,
        idempotencyKey: command.idempotencyKey,
        deadline: command.deadline,
        maxResults: command.maxResults,
        costBudgetUnits: estimatedCostUnits,
      },
      providerInput,
    );
    const candidates = page.records.flatMap((record) => provider.normalize(record));
    await input.usageLedger.complete(reservationId, "COMPLETED", page.billedUnits ?? 0);
    return {
      status: "COMPLETED",
      reservationId,
      candidates,
      hasMore: page.nextCursor !== undefined,
    };
  } catch (error) {
    await input.usageLedger.complete(reservationId, "FAILED", 0);
    throw error;
  }
}

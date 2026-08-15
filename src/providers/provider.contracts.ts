/** Transport- and persistence-independent provider boundary. */

import type { CandidateFinding, IdentifierType, ProviderHealth } from "../core/domain.types";

export type ProviderCategory = "SEARCH" | "SOCIAL" | "BROKER" | "BREACH" | "DOMAIN";
export type ProviderCapability = "BREACH_METADATA_BY_VERIFIED_EMAIL";
export type ProviderVerificationScope = "VERIFIED_EMAIL_SELF";

export interface ProviderInputReference {
  /** Opaque reference; raw values must not be placed in durable job payloads. */
  readonly identifierId?: string;
  readonly ownedAssetId?: string;
  readonly identifierType?: IdentifierType;
  readonly verificationScope: ProviderVerificationScope;
}

export interface ScanContext {
  readonly scanId: string;
  readonly providerRunId: string;
  readonly consentRecordId: string;
  readonly idempotencyKey: string;
  readonly deadline: string;
  readonly maxResults: number;
  readonly costBudgetUnits: number;
}

export interface ProviderPage<TRawRecord = unknown> {
  readonly records: readonly TRawRecord[];
  readonly nextCursor?: string;
  readonly billedUnits?: number;
}

export interface ProviderErrorDescriptor {
  readonly kind:
    "VALIDATION" | "AUTHORIZATION" | "RATE_LIMIT" | "TIMEOUT" | "UPSTREAM" | "BUDGET" | "PERMANENT";
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly safeCode: string;
}

export class ProviderContractError extends Error {
  readonly descriptor: ProviderErrorDescriptor;

  constructor(descriptor: ProviderErrorDescriptor) {
    super(descriptor.safeCode);
    this.name = "ProviderContractError";
    this.descriptor = descriptor;
  }
}

export interface FootprintProvider<TValidatedInput = unknown, TRawRecord = unknown> {
  readonly id: string;
  readonly category: ProviderCategory;
  readonly adapterVersion: string;
  readonly parserVersion: string;

  supports(input: ProviderInputReference, capability: ProviderCapability): boolean;
  validate(input: ProviderInputReference): Promise<TValidatedInput>;
  estimateCost(input: TValidatedInput): Promise<number>;
  scan(
    context: ScanContext,
    input: TValidatedInput,
    cursor?: string,
  ): Promise<ProviderPage<TRawRecord>>;
  normalize(record: TRawRecord): readonly CandidateFinding[];
  healthCheck(): Promise<ProviderHealth>;
}

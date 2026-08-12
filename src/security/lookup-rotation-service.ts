import "server-only";

import { identifierEncryptionContext } from "@/core/identifier-service";
import { withLookupRotationDatabase } from "@/database/client";
import {
  type EncryptionKeyring,
  createLookupToken,
  decryptSensitiveValue,
} from "@/security/crypto";
import type { LookupKeyring } from "@/security/lookup-keyring";
import { sql } from "drizzle-orm";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1_000;

type ConflictReasonCode =
  | "ENVELOPE_CHANGED"
  | "NORMALIZATION_CHANGED"
  | "OWNERSHIP_CHANGED"
  | "TOKEN_COLLISION"
  | "ENVELOPE_KEY_UNAVAILABLE";

interface MissingLookupTokenRow {
  readonly identifierId: string;
  readonly identityId: string;
  readonly identifierType: "EMAIL";
  readonly namespace: string;
  readonly encryptedValue: import("@/security/crypto").EncryptedEnvelope;
  readonly normalizationVersion: string;
}

export interface LookupTokenRotationBatchOptions {
  readonly envelopeKeyring: EncryptionKeyring;
  readonly targetLookupKeyring: LookupKeyring;
  readonly batchSize?: number;
  readonly dryRun?: boolean;
}

export interface LookupTokenRotationConflict {
  readonly identifierId: string;
  readonly reasonCode: ConflictReasonCode;
}

export interface LookupTokenRotationBatchResult {
  readonly dryRun: boolean;
  readonly planned: number;
  readonly migrated: number;
  readonly conflicts: readonly LookupTokenRotationConflict[];
  readonly skippedDeleted: number;
  readonly hasMore: boolean;
}

function validateLookupTokenRotationBatchInputs(
  batchSize: number,
  targetLookupKeyring: LookupKeyring,
): void {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error("LOOKUP_KEY_ROTATION_BATCH_SIZE_INVALID");
  }
  if (
    !targetLookupKeyring.keyId ||
    targetLookupKeyring.keyId.length < 1 ||
    targetLookupKeyring.keyId.length > 64
  ) {
    throw new Error("LOOKUP_KEY_ROTATION_TARGET_KEY_ID_INVALID");
  }
}

/**
 * Migrates one bounded batch of identifiers to carry a lookup token for
 * `targetLookupKeyring`, without ever rewrapping the envelope key. This
 * worker deliberately accepts only one envelope keyring (decrypt-only) and
 * one target lookup keyring, not a current/next pair, so it cannot be
 * repurposed for KEK rewrap (see key-rotation-service.ts). JavaScript
 * strings cannot be reliably zeroized, so this worker must be isolated,
 * short-lived, non-concurrent per record, free of heap snapshots/traces, and
 * restarted after bounded batches. It never returns plaintext or tokens. A
 * conflict is quarantined as an opaque identifier ID and reason code; it is
 * never resolved by overwriting or deleting another identifier's row.
 */
export async function migrateLookupTokenBatch(
  options: LookupTokenRotationBatchOptions,
): Promise<LookupTokenRotationBatchResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  validateLookupTokenRotationBatchInputs(batchSize, options.targetLookupKeyring);

  return withLookupRotationDatabase(async (database) => {
    const rows = await database.execute(sql<MissingLookupTokenRow>`
      select
        identifier_id as "identifierId",
        identity_id as "identityId",
        identifier_type as "identifierType",
        namespace,
        encrypted_value as "encryptedValue",
        normalization_version as "normalizationVersion"
      from public.list_identifiers_missing_lookup_token(
        ${options.targetLookupKeyring.keyId}::text,
        ${batchSize + 1}::integer
      )
    `);
    const candidates = (rows as unknown as MissingLookupTokenRow[]).slice(0, batchSize);
    const hasMore = rows.length > batchSize;

    if (options.dryRun) {
      return {
        dryRun: true,
        planned: candidates.length,
        migrated: 0,
        conflicts: [],
        skippedDeleted: 0,
        hasMore,
      };
    }

    let migrated = 0;
    let skippedDeleted = 0;
    const conflicts: LookupTokenRotationConflict[] = [];

    // Sequential, not concurrent: at most one record's plaintext exists in
    // memory at a time.
    for (const candidate of candidates) {
      // Envelope-key rotation (ADR 0015) and lookup-key rotation (ADR 0016)
      // are independent operations that can be mid-transition at the same
      // time, so the table may legitimately contain rows this single
      // envelope keyring cannot decrypt. That is a per-record conflict to
      // retry under the right envelope keyring, not a batch-wide failure.
      if (candidate.encryptedValue.keyId !== options.envelopeKeyring.keyId) {
        conflicts.push({
          identifierId: candidate.identifierId,
          reasonCode: "ENVELOPE_KEY_UNAVAILABLE",
        });
        continue;
      }

      const plaintext = decryptSensitiveValue(
        candidate.encryptedValue,
        identifierEncryptionContext(candidate.identityId, candidate.identifierId),
        options.envelopeKeyring,
      );
      const token = createLookupToken(plaintext, candidate.namespace, options.targetLookupKeyring);

      const result = await database.execute(sql<{ status: string }>`
        select public.insert_identifier_lookup_token_for_rotation(
          ${candidate.identifierId}::uuid,
          ${candidate.identityId}::uuid,
          ${candidate.identifierType}::public.identifier_type,
          ${candidate.namespace}::text,
          ${candidate.normalizationVersion}::text,
          ${options.targetLookupKeyring.keyId}::text,
          ${token}::text,
          ${JSON.stringify(candidate.encryptedValue)}::jsonb,
          ${candidate.normalizationVersion}::text
        ) as status
      `);
      const [outcome] = result as unknown as { status: string }[];

      switch (outcome?.status) {
        case "INSERTED":
        case "ALREADY_PRESENT":
          migrated += 1;
          break;
        case "DELETED":
          skippedDeleted += 1;
          break;
        case "ENVELOPE_CHANGED":
        case "NORMALIZATION_CHANGED":
        case "OWNERSHIP_CHANGED":
        case "TOKEN_COLLISION":
          conflicts.push({ identifierId: candidate.identifierId, reasonCode: outcome.status });
          break;
        default:
          throw new Error(`LOOKUP_KEY_ROTATION_UNEXPECTED_STATUS: ${String(outcome?.status)}`);
      }
    }

    return {
      dryRun: false,
      planned: candidates.length,
      migrated,
      conflicts,
      skippedDeleted,
      hasMore,
    };
  });
}

export interface BackfillLegacyLookupTokensOptions {
  readonly lookupKeyId: string;
  readonly batchSize?: number;
}

export interface BackfillLegacyLookupTokensResult {
  readonly copied: number;
  readonly hasMore: boolean;
}

/**
 * One-time, bounded, restart-safe copy of each identifier's existing legacy
 * `identifiers.lookup_token` into the child table under `lookupKeyId`. Call
 * once with the currently configured write key before the first real
 * rotation targets a different key; safe to call repeatedly.
 */
export async function backfillLegacyLookupTokens(
  options: BackfillLegacyLookupTokensOptions,
): Promise<BackfillLegacyLookupTokensResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error("LOOKUP_KEY_ROTATION_BATCH_SIZE_INVALID");
  }
  if (!options.lookupKeyId || options.lookupKeyId.length < 1 || options.lookupKeyId.length > 64) {
    throw new Error("LOOKUP_KEY_ROTATION_TARGET_KEY_ID_INVALID");
  }

  return withLookupRotationDatabase(async (database) => {
    const result = await database.execute(sql<{ copied: number; matched: number }>`
      select copied, matched
      from public.backfill_identifier_lookup_tokens(
        ${options.lookupKeyId}::text,
        ${batchSize}::integer
      )
    `);
    const [outcome] = result as unknown as { copied: number; matched: number }[];
    // `matched` (candidates found this batch), not `copied` (rows actually
    // inserted), determines whether another batch may be needed: a
    // concurrent backfill/rotation run can cause a genuine candidate to be
    // skipped via ON CONFLICT DO NOTHING without that meaning the sweep is done.
    return { copied: outcome?.copied ?? 0, hasMore: (outcome?.matched ?? 0) === batchSize };
  });
}

import "server-only";

import { getRotationDatabase } from "@/database/client";
import {
  type EncryptedEnvelope,
  type EncryptionKeyring,
  rewrapEncryptedEnvelope,
} from "@/security/crypto";
import { sql } from "drizzle-orm";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1_000;

interface RewrapCandidateRow {
  readonly identifierId: string;
  readonly encryptedValue: EncryptedEnvelope;
}

export interface RewrapIdentifierBatchOptions {
  readonly currentKeyring: EncryptionKeyring;
  readonly nextKeyring: EncryptionKeyring;
  readonly batchSize?: number;
  readonly dryRun?: boolean;
}

export interface RewrapIdentifierBatchResult {
  readonly dryRun: boolean;
  readonly planned: number;
  readonly rewrapped: number;
  readonly conflicts: number;
  readonly hasMore: boolean;
}

function validateRotationKeys(
  currentKeyring: EncryptionKeyring,
  nextKeyring: EncryptionKeyring,
): void {
  if (currentKeyring.keyId === nextKeyring.keyId) {
    throw new Error("KEY_ROTATION_IDS_MUST_DIFFER");
  }
  if (currentKeyring.encryptionKey.equals(nextKeyring.encryptionKey)) {
    throw new Error("KEY_ROTATION_KEYS_MUST_DIFFER");
  }
  if (!currentKeyring.lookupKey.equals(nextKeyring.lookupKey)) {
    throw new Error("LOOKUP_KEY_ROTATION_REQUIRES_SEPARATE_PROCEDURE");
  }
}

/**
 * Rewraps one bounded identifier batch without decrypting identifier values.
 * Candidate reads and compare-and-swap writes are exposed only through the
 * dedicated function-only rotation database role. Rerunning the operation is
 * safe because candidates are selected by their current envelope key ID.
 */
export async function rewrapIdentifierBatch(
  options: RewrapIdentifierBatchOptions,
): Promise<RewrapIdentifierBatchResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error("KEY_ROTATION_BATCH_SIZE_INVALID");
  }
  validateRotationKeys(options.currentKeyring, options.nextKeyring);

  const rows = await getRotationDatabase().execute(sql<RewrapCandidateRow>`
    select
      identifier_id as "identifierId",
      encrypted_value as "encryptedValue"
    from public.list_identifier_envelopes_for_rewrap(
      ${options.currentKeyring.keyId}::text,
      ${batchSize + 1}::integer
    )
  `);
  const candidates = (rows as unknown as RewrapCandidateRow[]).slice(0, batchSize);
  const hasMore = rows.length > batchSize;

  if (options.dryRun) {
    return {
      dryRun: true,
      planned: candidates.length,
      rewrapped: 0,
      conflicts: 0,
      hasMore,
    };
  }

  let rewrapped = 0;
  let conflicts = 0;
  for (const candidate of candidates) {
    const replacement = rewrapEncryptedEnvelope(
      candidate.encryptedValue,
      options.currentKeyring,
      options.nextKeyring,
    );
    const result = await getRotationDatabase().execute(sql<{ replaced: boolean }>`
      select public.replace_identifier_envelope_for_rewrap(
        ${candidate.identifierId}::uuid,
        ${JSON.stringify(candidate.encryptedValue)}::jsonb,
        ${JSON.stringify(replacement)}::jsonb,
        ${options.currentKeyring.keyId}::text,
        ${options.nextKeyring.keyId}::text
      ) as replaced
    `);
    const [outcome] = result as unknown as { replaced: boolean }[];
    if (outcome?.replaced) rewrapped += 1;
    else conflicts += 1;
  }

  return {
    dryRun: false,
    planned: candidates.length,
    rewrapped,
    conflicts,
    hasMore,
  };
}

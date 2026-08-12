import "server-only";

import type { AuthenticatedPrincipal } from "@/security/auth";
import { createLookupToken } from "@/security/crypto";
import { getApplicationLookupKeyring } from "@/security/lookup-keyring";
import { sql } from "drizzle-orm";

import { type DatabaseTransaction, withRuntimeDatabase } from "./client";

interface SubjectToken {
  readonly keyId: string;
  readonly token: string;
}

export interface SubjectTokens {
  readonly current: SubjectToken;
  readonly previous?: SubjectToken;
}

export function deletionSubjectTokens(subject: string): SubjectTokens {
  const lookupKeyring = getApplicationLookupKeyring();
  const current = {
    keyId: lookupKeyring.current.keyId,
    token: createLookupToken(subject, "deleted-auth-subject:v1", lookupKeyring.current),
  };
  if (!lookupKeyring.previous) return { current };
  return {
    current,
    previous: {
      keyId: lookupKeyring.previous.keyId,
      token: createLookupToken(subject, "deleted-auth-subject:v1", lookupKeyring.previous),
    },
  };
}

export function deletionSubjectToken(subject: string): string {
  return deletionSubjectTokens(subject).current.token;
}

/**
 * Runs a user-facing database operation with transaction-local tenant context.
 * PostgreSQL RLS policies deny access when both subject-token settings are
 * absent, and the settings disappear automatically at transaction end so
 * pooled connections cannot leak one request's identity into another.
 */
export async function withTenantDatabase<T>(
  principal: AuthenticatedPrincipal,
  operation: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  const tokens = deletionSubjectTokens(principal.subject);

  return withRuntimeDatabase((database) =>
    database.transaction(async (transaction) => {
      await transaction.execute(sql`
        select
          set_config('app.auth_subject', ${principal.subject}, true),
          set_config('app.subject_token', ${tokens.current.token}, true),
          set_config('app.subject_token_previous', ${tokens.previous?.token ?? ""}, true)
      `);
      return operation(transaction);
    }),
  );
}

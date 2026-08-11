import "server-only";

import type { AuthenticatedPrincipal } from "@/security/auth";
import { createLookupToken } from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";
import { sql } from "drizzle-orm";

import { getRuntimeDatabase, type DatabaseTransaction } from "./client";

export function deletionSubjectToken(subject: string): string {
  return createLookupToken(subject, "deleted-auth-subject:v1", getApplicationKeyring());
}

/**
 * Runs a user-facing database operation with transaction-local tenant context.
 * PostgreSQL RLS policies deny access when either setting is absent, and the
 * settings disappear automatically at transaction end so pooled connections
 * cannot leak one request's identity into another.
 */
export async function withTenantDatabase<T>(
  principal: AuthenticatedPrincipal,
  operation: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  const subjectToken = deletionSubjectToken(principal.subject);

  return getRuntimeDatabase().transaction(async (transaction) => {
    await transaction.execute(sql`
      select
        set_config('app.auth_subject', ${principal.subject}, true),
        set_config('app.subject_token', ${subjectToken}, true)
    `);
    return operation(transaction);
  });
}

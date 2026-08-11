import "server-only";

import { isIP } from "node:net";
import { getServerEnv } from "@/config/server-env";
import { getRuntimeDatabase } from "@/database/client";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { createLookupToken } from "@/security/crypto";
import { getApplicationKeyring } from "@/security/keyring";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";

export type RateLimitedAction =
  "ONBOARDING" | "IDENTIFIER_ADD" | "VERIFICATION_ATTEMPT" | "ACCOUNT_DELETE";

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly limitingScope: "USER" | "NETWORK" | null;
}

interface RateLimitRow {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly limitingScope: "USER" | "NETWORK" | null;
}

export function resolveTrustedNetworkIdentifier(
  requestHeaders: Pick<Headers, "get">,
  configuration: {
    readonly appEnv: "local" | "preview" | "production";
    readonly trustedClientIpHeader?: string;
  },
): string {
  if (configuration.appEnv === "local") return "local-development-network";
  if (!configuration.trustedClientIpHeader) {
    throw new Error("TRUSTED_CLIENT_IP_HEADER_REQUIRED");
  }

  const candidate = requestHeaders.get(configuration.trustedClientIpHeader)?.trim().toLowerCase();
  if (!candidate || candidate.includes(",") || candidate.length > 64 || isIP(candidate) === 0) {
    throw new Error("TRUSTED_CLIENT_IP_REQUIRED");
  }
  return candidate;
}

export async function consumeActionRateLimit(
  principal: AuthenticatedPrincipal,
  networkIdentifier: string,
  action: RateLimitedAction,
): Promise<RateLimitDecision> {
  const keyring = getApplicationKeyring();
  const userScopeToken = createLookupToken(principal.subject, "rate-limit-user:v1", keyring);
  const networkScopeToken = createLookupToken(networkIdentifier, "rate-limit-network:v1", keyring);

  const rows = await getRuntimeDatabase().execute(sql<RateLimitRow>`
    select
      allowed,
      retry_after_seconds as "retryAfterSeconds",
      limiting_scope as "limitingScope"
    from public.consume_action_rate_limit(
      ${userScopeToken},
      ${networkScopeToken},
      ${action}::public.rate_limit_action
    )
  `);
  const [decision] = rows as unknown as RateLimitRow[];
  if (!decision) throw new Error("RATE_LIMIT_DECISION_MISSING");
  return decision;
}

export async function consumeServerActionRateLimit(
  principal: AuthenticatedPrincipal,
  action: RateLimitedAction,
): Promise<RateLimitDecision> {
  const env = getServerEnv();
  const networkIdentifier =
    env.APP_ENV === "local"
      ? resolveTrustedNetworkIdentifier(new Headers(), { appEnv: "local" })
      : resolveTrustedNetworkIdentifier(await headers(), {
          appEnv: env.APP_ENV,
          trustedClientIpHeader: env.TRUSTED_CLIENT_IP_HEADER,
        });
  return consumeActionRateLimit(principal, networkIdentifier, action);
}

import "server-only";

import type { AccountContext } from "@/core/account-service";
import { breachFindings, providerRuns, scans } from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { desc, eq, inArray } from "drizzle-orm";

export interface BreachScanHistoryFinding {
  readonly id: string;
  readonly breachName: string;
  readonly breachDate: string;
  readonly dataCategories: readonly string[];
  readonly isVerified: boolean;
  readonly isSensitive: boolean;
  readonly isRetired: boolean;
  readonly sourceUrl: string;
  readonly parserVersion: string;
  readonly checkedAt: Date;
}

export interface BreachScanHistoryEntry {
  readonly scanId: string;
  readonly scanState: "QUEUED" | "RUNNING" | "PARTIAL" | "COMPLETED" | "FAILED" | "CANCELLED";
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly providerId: string | null;
  readonly providerRunState: "RUNNING" | "COMPLETED" | "FAILED" | null;
  readonly providerHealthOutcome: string | null;
  readonly errorSafeCode: string | null;
  readonly findings: readonly BreachScanHistoryFinding[];
}

function accountPrincipal(account: AccountContext): AuthenticatedPrincipal {
  return { subject: account.authSubject, mode: account.authMode };
}

export async function listRecentBreachScans(
  account: AccountContext,
  options: { readonly limit: number },
): Promise<readonly BreachScanHistoryEntry[]> {
  return withTenantDatabase(accountPrincipal(account), async (transaction) => {
    const scanRows = await transaction
      .select({
        scanId: scans.id,
        scanState: scans.state,
        startedAt: scans.startedAt,
        completedAt: scans.completedAt,
      })
      .from(scans)
      .where(eq(scans.userId, account.userId))
      .orderBy(desc(scans.startedAt))
      .limit(options.limit);

    const scanIds = scanRows.map((row) => row.scanId);
    const providerRunRows = scanIds.length
      ? await transaction
          .select({
            providerRunId: providerRuns.id,
            scanId: providerRuns.scanId,
            providerId: providerRuns.providerId,
            providerRunState: providerRuns.state,
            providerHealthOutcome: providerRuns.healthOutcome,
            errorSafeCode: providerRuns.errorSafeCode,
          })
          .from(providerRuns)
          .where(inArray(providerRuns.scanId, scanIds))
          .orderBy(desc(providerRuns.startedAt), desc(providerRuns.id))
      : [];
    const latestProviderRunByScan = new Map<string, (typeof providerRunRows)[number]>();
    for (const row of providerRunRows) {
      if (!latestProviderRunByScan.has(row.scanId)) latestProviderRunByScan.set(row.scanId, row);
    }
    const providerRunIds = [...latestProviderRunByScan.values()].map((row) => row.providerRunId);
    const findingRows = providerRunIds.length
      ? await transaction
          .select({
            id: breachFindings.id,
            providerRunId: breachFindings.providerRunId,
            breachName: breachFindings.breachName,
            breachDate: breachFindings.breachDate,
            dataCategories: breachFindings.dataCategories,
            isVerified: breachFindings.isVerified,
            isSensitive: breachFindings.isSensitive,
            isRetired: breachFindings.isRetired,
            sourceUrl: breachFindings.sourceUrl,
            parserVersion: breachFindings.parserVersion,
            checkedAt: breachFindings.checkedAt,
          })
          .from(breachFindings)
          .where(inArray(breachFindings.providerRunId, providerRunIds))
      : [];

    const findingsByProviderRun = new Map<string, BreachScanHistoryFinding[]>();
    for (const row of findingRows) {
      const list = findingsByProviderRun.get(row.providerRunId) ?? [];
      list.push({
        id: row.id,
        breachName: row.breachName,
        breachDate: row.breachDate,
        dataCategories: row.dataCategories,
        isVerified: row.isVerified,
        isSensitive: row.isSensitive,
        isRetired: row.isRetired,
        sourceUrl: row.sourceUrl,
        parserVersion: row.parserVersion,
        checkedAt: row.checkedAt,
      });
      findingsByProviderRun.set(row.providerRunId, list);
    }

    return scanRows.map((row) => {
      const providerRun = latestProviderRunByScan.get(row.scanId);
      return {
        scanId: row.scanId,
        scanState: row.scanState,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        providerId: providerRun?.providerId ?? null,
        providerRunState: providerRun?.providerRunState ?? null,
        providerHealthOutcome: providerRun?.providerHealthOutcome ?? null,
        errorSafeCode: providerRun?.errorSafeCode ?? null,
        findings: providerRun ? (findingsByProviderRun.get(providerRun.providerRunId) ?? []) : [],
      };
    });
  });
}

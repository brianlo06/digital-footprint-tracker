import {
  describeBreachProvider,
  isDegradedHealthOutcome,
} from "@/providers/breach/breach-coverage-guidance";
import type { BreachScanHistoryEntry } from "@/providers/breach/breach-scan-history";

import { cancelQueuedBreachScanAction } from "../dashboard/actions";

export function ScanHistoryList({ scans }: { scans: readonly BreachScanHistoryEntry[] }) {
  return scans.length === 0 ? (
    <div className="empty-state">No scan has run yet.</div>
  ) : (
    <div className="stack">
      {scans.map((scan) => (
        <article className="identifier-row" key={scan.scanId}>
          <div>
            <p>
              {scan.providerId
                ? describeBreachProvider(scan.providerId).displayName
                : "Awaiting provider dispatch"}{" "}
              · {scan.startedAt.toLocaleString()}
            </p>
            {scan.errorSafeCode ? (
              <p className="muted">Safe failure code: {scan.errorSafeCode}</p>
            ) : null}
            {isDegradedHealthOutcome(scan.providerHealthOutcome) ? (
              <p className="muted">
                Provider health at this check: {scan.providerHealthOutcome} — coverage may be
                incomplete.
              </p>
            ) : null}
            {scan.findings.length > 0 ? (
              <div className="stack">
                {scan.findings.map((finding) => (
                  <div key={finding.id}>
                    <p>
                      <strong>{finding.breachName}</strong> · breach date {finding.breachDate} ·
                      checked {finding.checkedAt.toLocaleString()}
                    </p>
                    <p className="muted">
                      Source (fictional URL):{" "}
                      <a href={finding.sourceUrl} rel="noreferrer" target="_blank">
                        {finding.sourceUrl}
                        <span className="visually-hidden"> (opens in a new tab)</span>
                      </a>{" "}
                      · parser {finding.parserVersion}
                    </p>
                    <p>
                      {finding.dataCategories.map((category) => (
                        <span className="badge" key={category}>
                          {category}
                        </span>
                      ))}
                      {finding.isVerified ? <span className="badge">provider-verified</span> : null}
                      {finding.isSensitive ? <span className="badge">sensitive</span> : null}
                      {finding.isRetired ? <span className="badge">retired</span> : null}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="stack">
            <span className="badge">{scan.scanState.toLowerCase()}</span>
            {scan.scanState === "QUEUED" ? (
              <form action={cancelQueuedBreachScanAction}>
                <input name="scanId" type="hidden" value={scan.scanId} />
                <button className="button secondary" type="submit">
                  Cancel queued scan
                </button>
              </form>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

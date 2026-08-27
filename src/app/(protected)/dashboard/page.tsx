import { findAccount } from "@/core/account-service";
import { listIdentifiers } from "@/core/identifier-service";
import { getBreachConsentSummary } from "@/privacy/breach-consent-service";
import { listRecentBreachScans } from "@/providers/breach/breach-scan-history";
import Link from "next/link";
import { redirect } from "next/navigation";

import { cancelQueuedBreachScanAction, runBreachScanAction } from "./actions";
import { requireProtectedPagePrincipal } from "../principal";

export const metadata = { title: "Privacy overview" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SCAN_STATUS_MESSAGES: Record<string, string> = {
  completed: "Synthetic breach check finished.",
  queued: "Synthetic breach check queued. Refresh shortly to see the worker result.",
  denied: "The synthetic breach check was denied by a safety gate. No provider call was made.",
  no_eligible_target:
    "No verified email with granted breach-metadata permission is currently eligible.",
  provider_disabled: "The synthetic breach provider is not enabled in this environment.",
  already_running: "A scan is already running. Its result will appear here shortly.",
  unexpected_replay: "This scan could not be dispatched. Try again.",
  rate_limited: "Too many scan attempts. Try again shortly.",
  failed: "The scan could not be completed.",
  cancelled: "The queued scan was cancelled before provider dispatch.",
  not_cancellable: "That scan has already started or reached a final state.",
  cancel_failed: "The queued scan could not be cancelled.",
};

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const parameters = await searchParams;
  const account = await findAccount(await requireProtectedPagePrincipal());
  if (!account) redirect("/onboarding");
  const [identifierList, breachConsent, recentScans] = await Promise.all([
    listIdentifiers(account),
    getBreachConsentSummary(account),
    listRecentBreachScans(account, { limit: 5 }),
  ]);
  const verified = identifierList.filter((item) => item.verificationStatus === "VERIFIED").length;
  const hasVerifiedEmail = identifierList.some(
    (identifier) => identifier.verificationStatus === "VERIFIED",
  );
  const breachConsentGranted = breachConsent?.state === "GRANTED";
  const canRunScan = hasVerifiedEmail && breachConsentGranted;
  const scanParam = typeof parameters.scan === "string" ? parameters.scan : undefined;

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Foundation status</p>
        <h1>Privacy overview</h1>
        <p className="lede">
          Your private foundation is ready. A user-triggered synthetic breach-metadata check is
          available once a verified email and matching permission exist.
        </p>
      </header>
      <div className="grid">
        <article className="card">
          <p className="eyebrow">Identifiers</p>
          <h2>{identifierList.length}</h2>
          <p className="muted">Stored with application-level encryption.</p>
        </article>
        <article className="card">
          <p className="eyebrow">Verified</p>
          <h2>{verified}</h2>
          <p className="muted">Eligible for future capabilities only after separate approval.</p>
        </article>
        <article className="card">
          <p className="eyebrow">External providers</p>
          <h2>{canRunScan ? 1 : 0}</h2>
          <p className="muted">
            {canRunScan
              ? "Synthetic breach-metadata provider only; no live network source is active."
              : "No search, breach, broker, social, or domain source is active."}
          </p>
        </article>
      </div>

      {scanParam && SCAN_STATUS_MESSAGES[scanParam] ? (
        <div className="notice" role="status">
          {SCAN_STATUS_MESSAGES[scanParam]}
        </div>
      ) : null}

      <section aria-labelledby="breach-scan-heading" className="card">
        <h2 id="breach-scan-heading">Synthetic breach-metadata check</h2>
        <p className="notice warning">
          Synthetic test data. This does not reflect a real breach check and is not proof of current
          account compromise.
        </p>
        {!canRunScan ? (
          <div className="notice">
            {hasVerifiedEmail
              ? "Grant breach-metadata permission on the privacy settings page to enable a check."
              : "Verify an email and grant breach-metadata permission on the privacy settings page to enable a check."}
          </div>
        ) : (
          <form action={runBreachScanAction} className="form-grid">
            <button type="submit">Run synthetic breach check</button>
          </form>
        )}

        <h3>Recent scans</h3>
        {recentScans.length === 0 ? (
          <div className="empty-state">No scan has run yet.</div>
        ) : (
          <div className="stack">
            {recentScans.map((scan) => (
              <article className="identifier-row" key={scan.scanId}>
                <div>
                  <p>
                    {scan.providerId ?? "no provider"} · {scan.startedAt.toLocaleString()}
                  </p>
                  {scan.errorSafeCode ? (
                    <p className="muted">Safe failure code: {scan.errorSafeCode}</p>
                  ) : null}
                  {scan.findings.length > 0 ? (
                    <div className="stack">
                      {scan.findings.map((finding) => (
                        <div key={finding.id}>
                          <p>
                            <strong>{finding.breachName}</strong> · breach date {finding.breachDate}{" "}
                            · checked {finding.checkedAt.toLocaleString()}
                          </p>
                          <p className="muted">
                            Source:{" "}
                            <a href={finding.sourceUrl} rel="noreferrer" target="_blank">
                              {finding.sourceUrl}
                            </a>{" "}
                            · parser {finding.parserVersion}
                          </p>
                          <p>
                            {finding.dataCategories.map((category) => (
                              <span className="badge" key={category}>
                                {category}
                              </span>
                            ))}
                            {finding.isVerified ? (
                              <span className="badge">provider-verified</span>
                            ) : null}
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
        )}
        <div className="inline-actions">
          <Link className="button secondary" href="/dashboard">
            Refresh scan status
          </Link>
        </div>
      </section>

      <div className="status-panel">
        <h2>Next safe step</h2>
        <p>
          Add and verify a synthetic or personal email locally. It will not be transmitted to an
          email service or scanning provider.
        </p>
        <Link className="button" href="/identities">
          Manage identifiers
        </Link>
      </div>
    </div>
  );
}

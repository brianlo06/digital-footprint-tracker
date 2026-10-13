import { getServerEnv } from "@/config/server-env";
import { findAccount } from "@/core/account-service";
import { listTrackedFindings } from "@/core/finding-history";
import { listIdentifiers } from "@/core/identifier-service";
import { getBreachConsentSummary } from "@/privacy/breach-consent-service";
import {
  isDegradedHealthOutcome,
  summarizeBreachCoverage,
} from "@/providers/breach/breach-coverage-guidance";
import { isBreachVerificationRecent } from "@/providers/breach/breach-invocation-policy";
import { listRecentBreachScans } from "@/providers/breach/breach-scan-history";
import { selectBreachProviderFromEnv } from "@/providers/provider-registry";
import Link from "next/link";
import { redirect } from "next/navigation";

import { runBreachScanAction } from "./actions";
import { ScanHistoryList } from "../history/scan-history-list";
import { TrackedFindingList } from "../history/tracked-finding-list";
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
  const [identifierList, breachConsent, recentScans, trackedFindings] = await Promise.all([
    listIdentifiers(account),
    getBreachConsentSummary(account),
    listRecentBreachScans(account, { limit: 5 }),
    listTrackedFindings(account, { limit: 10 }),
  ]);
  const verified = identifierList.filter((item) => item.verificationStatus === "VERIFIED").length;
  const hasVerifiedEmail = identifierList.some(
    (identifier) => identifier.verificationStatus === "VERIFIED",
  );
  // Mirrors the authorization gate so a stale verification is explained here
  // instead of surfacing as a denied scan; the gate itself remains the control.
  const hasRecentlyVerifiedEmail = identifierList.some(
    (identifier) =>
      identifier.verificationStatus === "VERIFIED" &&
      isBreachVerificationRecent(identifier.lastVerifiedAt),
  );
  const breachConsentGranted = breachConsent?.state === "GRANTED";
  const selection = selectBreachProviderFromEnv(getServerEnv());
  const providerEnabled = Boolean(selection.provider);
  const canRunScan = hasRecentlyVerifiedEmail && breachConsentGranted && providerEnabled;
  const scanParam = typeof parameters.scan === "string" ? parameters.scan : undefined;
  const coverage = summarizeBreachCoverage({
    selection,
    recentScans,
  });

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Local synthetic demo</p>
        <h1>Privacy overview</h1>
        <p className="lede">
          Explore a complete check using fictional breach metadata: verify a test identifier, grant
          permission, run a scan, then compare findings and history. No live lookup is made.
        </p>
      </header>
      <section className="card" aria-labelledby="demo-steps-heading">
        <h2 id="demo-steps-heading">Try the workflow</h2>
        <ol>
          <li>
            <Link href="/identities">Add and verify demo@example.test</Link> using the local fixture
            code (default 000000).
          </li>
          <li>
            <Link href="/settings/privacy">Grant breach-metadata permission</Link>. Consent alone
            starts no scan.
          </li>
          <li>Run a synthetic check below, then refresh its status to see the processed result.</li>
          <li>
            Run it again: recent scans gain a second entry while the same finding stays
            deduplicated.
          </li>
        </ol>
      </section>
      <div className="grid">
        <article className="card">
          <p className="eyebrow">Identifiers</p>
          <h2>{identifierList.length}</h2>
          <p className="muted">Stored with application-level encryption.</p>
        </article>
        <article className="card">
          <p className="eyebrow">Verified</p>
          <h2>{verified}</h2>
          <p className="muted">
            Local verification; scan authorization also requires recent verification and consent.
          </p>
        </article>
        <article className="card">
          <p className="eyebrow">Synthetic source</p>
          <h2>{providerEnabled ? 1 : 0}</h2>
          <p className="muted">
            {providerEnabled
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
            {!providerEnabled ? (
              "The synthetic source is disabled. Follow the README local demo configuration, then restart the development server."
            ) : !hasVerifiedEmail ? (
              "Verify an email and grant breach-metadata permission on the privacy settings page to enable a check."
            ) : !hasRecentlyVerifiedEmail ? (
              <>
                Your email was verified more than 24 hours ago.{" "}
                <Link href="/identities">Verify it again</Link> to enable a check.
              </>
            ) : (
              "Grant breach-metadata permission on the privacy settings page to enable a check."
            )}
          </div>
        ) : (
          <form action={runBreachScanAction} className="form-grid">
            <button type="submit">Run synthetic breach check</button>
          </form>
        )}

        <h3>Recent scans</h3>
        <p className="muted">
          Showing the latest five checks. Queued work runs after the response; refresh to load its
          current state.
        </p>
        <ScanHistoryList scans={recentScans} />
        <div className="inline-actions">
          <form action="/dashboard" method="get">
            <button className="button secondary" type="submit">
              Refresh scan status
            </button>
          </form>
          <Link className="button secondary" href="/history">
            View full history
          </Link>
        </div>
      </section>

      <section aria-labelledby="tracked-findings-heading" className="card">
        <h2 id="tracked-findings-heading">Tracked findings</h2>
        <p className="muted">
          Showing up to ten distinct findings, kept stable across checks so absence and reappearance
          stay visible. A finding is only called resolved after repeated confirmed absences; a
          failed or degraded check never counts as one.
        </p>
        <TrackedFindingList findings={trackedFindings} />
      </section>

      <section aria-labelledby="coverage-heading" className="card">
        <h2 id="coverage-heading">Coverage and limits</h2>
        {coverage.providerEnabled && coverage.provider ? (
          <p>
            Enabled source:{" "}
            {coverage.provider.attributionUrl ? (
              <a href={coverage.provider.attributionUrl} rel="noreferrer" target="_blank">
                {coverage.provider.displayName}
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            ) : (
              <strong>{coverage.provider.displayName}</strong>
            )}
            . {coverage.provider.description}
          </p>
        ) : (
          <p>No breach-metadata source is enabled in this environment, so nothing is checked.</p>
        )}
        <p className="muted">
          {coverage.lastCompletedCheckAt
            ? `Last completed check in recent history: ${coverage.lastCompletedCheckAt.toLocaleString()}.`
            : "No check has completed in recent history."}
          {coverage.latestScanState === "FAILED"
            ? " The most recent check failed, so its coverage is missing entirely."
            : null}
          {coverage.latestScanState === "PARTIAL"
            ? " The most recent check completed only partially, so its coverage is incomplete."
            : null}
        </p>
        {isDegradedHealthOutcome(coverage.latestHealthOutcome) ? (
          <p className="notice warning" role="status">
            The provider last reported {coverage.latestHealthOutcome}. Results from that check may
            be incomplete, and a check that returns nothing under degraded health is not evidence
            that nothing was found.
          </p>
        ) : null}
        <ul>
          {coverage.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </section>

      <div className="status-panel">
        <h2>Next safe step</h2>
        <p>
          Use fictional .test addresses only in this demo. They will not be transmitted to an email
          service or scanning provider.
        </p>
        <Link className="button" href="/identities">
          Manage identifiers
        </Link>
      </div>
    </div>
  );
}

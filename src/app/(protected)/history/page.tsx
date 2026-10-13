import { findAccount } from "@/core/account-service";
import { listTrackedFindings } from "@/core/finding-history";
import { listRecentBreachScans } from "@/providers/breach/breach-scan-history";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireProtectedPagePrincipal } from "../principal";
import { HISTORY_PAGE_SIZE, parseHistoryPage, takeHistoryPage } from "./pagination";
import { ScanHistoryList } from "./scan-history-list";
import { TrackedFindingList } from "./tracked-finding-list";

export const metadata = { title: "History" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Pager({
  label,
  page,
  hasNext,
  hrefFor,
}: {
  label: string;
  page: number;
  hasNext: boolean;
  hrefFor: (page: number) => string;
}) {
  if (page === 1 && !hasNext) return null;
  return (
    <nav aria-label={`${label} pages`} className="inline-actions">
      {page > 1 ? (
        <Link className="button secondary" href={hrefFor(page - 1)}>
          Newer {label.toLowerCase()}
        </Link>
      ) : null}
      <span className="muted">Page {page}</span>
      {hasNext ? (
        <Link className="button secondary" href={hrefFor(page + 1)}>
          Older {label.toLowerCase()}
        </Link>
      ) : null}
    </nav>
  );
}

export default async function HistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const parameters = await searchParams;
  const account = await findAccount(await requireProtectedPagePrincipal());
  if (!account) redirect("/onboarding");
  const scanPage = parseHistoryPage(parameters.scans);
  const findingPage = parseHistoryPage(parameters.findings);
  const [scanRows, findingRows] = await Promise.all([
    listRecentBreachScans(account, {
      limit: HISTORY_PAGE_SIZE + 1,
      offset: (scanPage - 1) * HISTORY_PAGE_SIZE,
    }),
    listTrackedFindings(account, {
      limit: HISTORY_PAGE_SIZE + 1,
      offset: (findingPage - 1) * HISTORY_PAGE_SIZE,
    }),
  ]);
  const scans = takeHistoryPage(scanRows);
  const findings = takeHistoryPage(findingRows);

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Local synthetic demo</p>
        <h1>History</h1>
        <p className="lede">
          Every check and tracked finding stored for this account, newest first. All results are
          fictional.
        </p>
      </header>

      <section aria-labelledby="history-scans-heading" className="card">
        <h2 id="history-scans-heading">Scans</h2>
        <p className="muted">
          Each check with its state, source, and the findings that check returned.
        </p>
        <ScanHistoryList scans={scans.items} />
        <Pager
          hasNext={scans.hasNext}
          hrefFor={(page) => `/history?scans=${page}&findings=${findingPage}#history-scans-heading`}
          label="Scans"
          page={scanPage}
        />
      </section>

      <section aria-labelledby="history-findings-heading" className="card">
        <h2 id="history-findings-heading">Tracked findings</h2>
        <p className="muted">
          Distinct findings kept stable across checks, ordered by most recent check. A finding is
          only called resolved after repeated confirmed absences; a failed or degraded check never
          counts as one.
        </p>
        <TrackedFindingList findings={findings.items} />
        <Pager
          hasNext={findings.hasNext}
          hrefFor={(page) => `/history?scans=${scanPage}&findings=${page}#history-findings-heading`}
          label="Findings"
          page={findingPage}
        />
      </section>

      <div className="inline-actions">
        <Link className="button" href="/dashboard">
          Back to overview
        </Link>
      </div>
    </div>
  );
}

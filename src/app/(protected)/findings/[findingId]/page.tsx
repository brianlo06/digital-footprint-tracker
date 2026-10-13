import { findAccount } from "@/core/account-service";
import { availableReviewDecisions } from "@/core/finding-review";
import { getFindingDetail } from "@/core/finding-review-service";
import { describeBreachProvider } from "@/providers/breach/breach-coverage-guidance";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireProtectedPagePrincipal } from "../../principal";
import {
  FINDING_PRESENCE_EXPLANATIONS,
  FINDING_STATUS_EXPLANATIONS,
  FINDING_STATUS_LABELS,
  OBSERVATION_PRESENCE_EXPLANATIONS,
  OBSERVATION_PRESENCE_LABELS,
  REVIEW_DECISION_LABELS,
} from "../finding-labels";
import { reviewFindingAction } from "./actions";

export const metadata = { title: "Finding detail" };

type Params = Promise<{ findingId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const REVIEW_MESSAGES: Record<string, { text: string; danger: boolean }> = {
  saved: { text: "Your review was saved.", danger: false },
  unchanged: { text: "That review was already in place, so nothing changed.", danger: false },
  invalid: { text: "That review option is not available. Choose one below.", danger: true },
  failed: { text: "Your review could not be saved. Try again.", danger: true },
};

export default async function FindingDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ findingId }, parameters] = await Promise.all([params, searchParams]);
  const account = await findAccount(await requireProtectedPagePrincipal());
  if (!account) redirect("/onboarding");
  const finding = await getFindingDetail(account, findingId);
  // A finding that belongs to another account is indistinguishable from one
  // that does not exist.
  if (!finding) notFound();

  const provider = describeBreachProvider(finding.sourceProviderId);
  const decisions = availableReviewDecisions(finding);
  const reviewMessage =
    typeof parameters.review === "string" ? REVIEW_MESSAGES[parameters.review] : undefined;

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Finding · synthetic data</p>
        <h1>{finding.title}</h1>
        <p className="lede">
          Reported by {provider.displayName} for {finding.normalizedHost}. This is fictional
          provider metadata and is not proof of current account compromise.
        </p>
      </header>

      {reviewMessage ? (
        <div
          className={reviewMessage.danger ? "notice danger" : "notice"}
          role={reviewMessage.danger ? "alert" : "status"}
        >
          {reviewMessage.text}
        </div>
      ) : null}

      <section aria-labelledby="finding-state-heading" className="card">
        <h2 id="finding-state-heading">Current state</h2>
        <dl className="fact-list">
          <div>
            <dt>Status</dt>
            <dd>
              <span className="badge">{FINDING_STATUS_LABELS[finding.status]}</span>{" "}
              {FINDING_STATUS_EXPLANATIONS[finding.status]}
            </dd>
          </div>
          <div>
            <dt>Reported by the provider</dt>
            <dd>
              <span className="badge">{finding.presenceState.toLowerCase()}</span>{" "}
              {FINDING_PRESENCE_EXPLANATIONS[finding.presenceState]}
            </dd>
          </div>
          <div>
            <dt>First seen</dt>
            <dd>{finding.firstSeenAt.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>{finding.lastSeenAt ? finding.lastSeenAt.toLocaleString() : "Never"}</dd>
          </div>
          <div>
            <dt>Last checked</dt>
            <dd>{finding.lastCheckedAt.toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="finding-why-heading" className="card">
        <h2 id="finding-why-heading">Why you are seeing this</h2>
        <dl className="fact-list">
          <div>
            <dt>Matched identifier</dt>
            <dd>
              {finding.matchedIdentifierMasked ??
                "The identifier that matched has since been removed."}
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {provider.displayName}. {provider.description}
            </dd>
          </div>
          <div>
            <dt>What is stored</dt>
            <dd>
              The provider&apos;s name for this record, its host, and one entry per check. No raw
              provider response and no credential data is kept.
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="finding-review-heading" className="card">
        <h2 id="finding-review-heading">Review this finding</h2>
        <p className="muted">
          A review records what you say about this finding. It never changes what the provider
          reported, and later checks keep recording it either way.
        </p>
        {decisions.length === 0 ? (
          <p>No review option applies to this finding right now.</p>
        ) : (
          <div className="inline-actions">
            {decisions.map((decision) => (
              <form action={reviewFindingAction} key={decision}>
                <input name="findingId" type="hidden" value={finding.id} />
                <input name="decision" type="hidden" value={decision} />
                <button
                  className={decision === "CONFIRMED" ? undefined : "button secondary"}
                  type="submit"
                >
                  {REVIEW_DECISION_LABELS[decision]}
                </button>
              </form>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="finding-history-heading" className="card">
        <h2 id="finding-history-heading">Check history</h2>
        <p className="muted">
          One entry per check, newest first. An inconclusive check never counts as the finding going
          away.
        </p>
        {finding.observations.length === 0 ? (
          <div className="empty-state">
            No check history is stored for this finding. Older entries are removed by retention.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="visually-hidden">Check history for {finding.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Checked</th>
                  <th scope="col">Result</th>
                  <th scope="col">Source date</th>
                  <th scope="col">Parser</th>
                </tr>
              </thead>
              <tbody>
                {finding.observations.map((observation) => (
                  <tr key={observation.id}>
                    <td>{observation.observedAt.toLocaleString()}</td>
                    <td>
                      <strong>{OBSERVATION_PRESENCE_LABELS[observation.presence]}</strong>
                      {observation.contentChanged ? " · details changed" : ""}
                      <br />
                      <span className="muted">
                        {OBSERVATION_PRESENCE_EXPLANATIONS[observation.presence]}
                      </span>
                    </td>
                    <td>{observation.sourceDate ?? "—"}</td>
                    <td>{observation.parserVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {finding.observationsTruncated ? (
          <p className="muted">Showing the 50 most recent checks.</p>
        ) : null}
      </section>

      <div className="inline-actions">
        <Link className="button secondary" href="/history#history-findings-heading">
          Back to history
        </Link>
      </div>
    </div>
  );
}

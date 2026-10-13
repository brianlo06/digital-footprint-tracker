import type { TrackedFinding } from "@/core/finding-history";
import { describeBreachProvider } from "@/providers/breach/breach-coverage-guidance";
import Link from "next/link";

import { FINDING_STATUS_LABELS } from "../findings/finding-labels";

export function TrackedFindingList({ findings }: { findings: readonly TrackedFinding[] }) {
  return findings.length === 0 ? (
    <div className="empty-state">No finding is being tracked yet.</div>
  ) : (
    <div className="stack">
      {findings.map((finding) => (
        <article className="identifier-row" key={finding.id}>
          <div>
            <p>
              <strong>
                <Link href={`/findings/${finding.id}`}>{finding.title}</Link>
              </strong>{" "}
              · {describeBreachProvider(finding.sourceProviderId).displayName}
            </p>
            <p className="muted">
              First seen {finding.firstSeenAt.toLocaleString()} · last seen{" "}
              {finding.lastSeenAt ? finding.lastSeenAt.toLocaleString() : "never"} · last checked{" "}
              {finding.lastCheckedAt.toLocaleString()}
            </p>
          </div>
          <div className="stack">
            <span className="badge">{finding.presenceState.toLowerCase()}</span>
            <span className="badge">{FINDING_STATUS_LABELS[finding.status]}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

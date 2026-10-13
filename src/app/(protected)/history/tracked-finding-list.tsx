import type { TrackedFinding } from "@/core/finding-history";
import { describeBreachProvider } from "@/providers/breach/breach-coverage-guidance";

export function TrackedFindingList({ findings }: { findings: readonly TrackedFinding[] }) {
  return findings.length === 0 ? (
    <div className="empty-state">No finding is being tracked yet.</div>
  ) : (
    <div className="stack">
      {findings.map((finding) => (
        <article className="identifier-row" key={finding.id}>
          <div>
            <p>
              <strong>{finding.title}</strong> ·{" "}
              {describeBreachProvider(finding.sourceProviderId).displayName}
            </p>
            <p className="muted">
              First seen {finding.firstSeenAt.toLocaleString()} · last seen{" "}
              {finding.lastSeenAt ? finding.lastSeenAt.toLocaleString() : "never"} · last checked{" "}
              {finding.lastCheckedAt.toLocaleString()}
            </p>
          </div>
          <div className="stack">
            <span className="badge">{finding.presenceState.toLowerCase()}</span>
            <span className="badge">{finding.status.toLowerCase().replace(/_/g, " ")}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

import { createHash } from "node:crypto";

/**
 * Deterministic finding identity, versioned so a normalization change can
 * never silently re-identify existing findings. Bump this and leave old rows
 * on their recorded version; never recompute history in place.
 *
 * `v1` normalizes the source host only. Reducing a host to its registrable
 * domain needs a public-suffix list, which would change identity for
 * multi-label suffixes, so that refinement must arrive as `v2`.
 */
export const FINDING_FINGERPRINT_VERSION = "v1";

export interface FindingFingerprintInput {
  readonly findingType: string;
  readonly providerScope: string;
  /** Normalized host of the source URL; see the version note above. */
  readonly normalizedHost: string;
  /** Keyed HMAC lookup token. A raw identifier value must never reach here. */
  readonly identifierLookupToken: string;
  /** Stable provider external ID where one exists, else a canonical resource key. */
  readonly normalizedResourceId: string;
  readonly fingerprintVersion?: string;
}

/**
 * Length-prefixes every field so no combination of separators inside one
 * value can imitate a different field split and collide two findings.
 */
function encodeField(value: string): string {
  return `${value.length}:${value}`;
}

export function normalizeHost(untrustedUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(untrustedUrl);
  } catch {
    throw new Error("FINGERPRINT_SOURCE_URL_INVALID");
  }
  const host = parsed.hostname.toLowerCase();
  const withoutWww = host.startsWith("www.") ? host.slice(4) : host;
  // A trailing dot is the same host in DNS but a different string.
  const normalized = withoutWww.endsWith(".") ? withoutWww.slice(0, -1) : withoutWww;
  if (normalized.length === 0) throw new Error("FINGERPRINT_SOURCE_URL_INVALID");
  return normalized;
}

/**
 * Hashes the normalized content an observation actually saw, so a later
 * check can show that the same finding's details changed. Fields are
 * length-prefixed for the same reason as the identity fingerprint.
 */
export function computeContentFingerprint(fields: readonly string[]): string {
  return createHash("sha256").update(fields.map(encodeField).join("")).digest("hex");
}

export function computeFindingFingerprint(input: FindingFingerprintInput): string {
  const version = input.fingerprintVersion ?? FINDING_FINGERPRINT_VERSION;
  const fields = [
    version,
    input.findingType,
    input.providerScope,
    input.normalizedHost,
    input.identifierLookupToken,
    input.normalizedResourceId,
  ];
  if (fields.some((field) => field.length === 0)) {
    throw new Error("FINGERPRINT_FIELD_EMPTY");
  }
  return createHash("sha256").update(fields.map(encodeField).join("")).digest("hex");
}

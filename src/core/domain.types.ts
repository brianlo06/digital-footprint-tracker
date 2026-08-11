/**
 * ARCHITECTURE / SCAFFOLD PHASE — PRODUCT FUNCTIONALITY NOT YET IMPLEMENTED.
 * Proposed transport- and persistence-independent domain vocabulary only.
 */

export type FindingType =
  | "WEB_MENTION"
  | "SOCIAL_PROFILE"
  | "EMAIL_EXPOSURE"
  | "PHONE_EXPOSURE"
  | "ADDRESS_EXPOSURE"
  | "DATA_BROKER_PROFILE"
  | "BREACH"
  | "DOMAIN_EXPOSURE"
  | "PUBLIC_DOCUMENT"
  | "USERNAME_MATCH"
  | "OTHER";

export type FindingConfidence = "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERIFIED";

export type FindingSensitivity = "PUBLIC" | "LOW" | "MODERATE" | "SENSITIVE" | "HIGHLY_SENSITIVE";

export type FindingStatus =
  | "NEW"
  | "REVIEWED"
  | "CONFIRMED"
  | "FALSE_POSITIVE"
  | "IGNORED"
  | "REMEDIATION_IN_PROGRESS"
  | "RESOLVED"
  | "REAPPEARED";

export type IdentifierType =
  | "EMAIL"
  | "USERNAME"
  | "PHONE"
  | "FULL_NAME"
  | "ALIAS"
  | "DOMAIN"
  | "WEBSITE"
  | "SOCIAL_PROFILE"
  | "ORGANIZATION"
  | "LOCATION";

export type ScanStatus = "QUEUED" | "RUNNING" | "PARTIAL" | "COMPLETED" | "FAILED" | "CANCELLED";
export type Presence = "PRESENT" | "MISSING" | "INDETERMINATE";
export type ProviderHealth = "HEALTHY" | "DEGRADED" | "RATE_LIMITED" | "UNAVAILABLE" | "DISABLED";

export interface EvidenceSummary {
  readonly kind: string;
  readonly redactedSummary: string;
  readonly sourceUrl?: string;
  readonly providerExternalId?: string;
  readonly parserVersion: string;
  readonly confidenceMethodVersion: string;
}

export interface CandidateFinding {
  readonly type: FindingType;
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly canonicalUrl?: string;
  readonly matchedIdentifierId?: string;
  readonly confidence: FindingConfidence;
  readonly sensitivity: FindingSensitivity;
  readonly presence: Presence;
  readonly evidence: readonly EvidenceSummary[];
}

import type { EncryptedEnvelope } from "@/security/crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const accountState = pgEnum("account_state", ["ACTIVE", "DELETION_PENDING"]);
export const identityState = pgEnum("identity_state", ["ACTIVE", "ARCHIVED"]);
export const identifierType = pgEnum("identifier_type", [
  "EMAIL",
  "USERNAME",
  "PHONE",
  "FULL_NAME",
  "ALIAS",
  "DOMAIN",
  "WEBSITE",
  "SOCIAL_PROFILE",
  "ORGANIZATION",
  "LOCATION",
]);
export const verificationStatus = pgEnum("verification_status", [
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "EXPIRED",
  "REVOKED",
]);
export const sensitivity = pgEnum("sensitivity", [
  "PUBLIC",
  "LOW",
  "MODERATE",
  "SENSITIVE",
  "HIGHLY_SENSITIVE",
]);
export const consentState = pgEnum("consent_state", ["GRANTED", "WITHDRAWN"]);
export const deletionState = pgEnum("deletion_state", [
  "REQUESTED",
  "AUTH_REVOKED",
  "COMPLETED",
  "FAILED",
]);
export const rateLimitScopeKind = pgEnum("rate_limit_scope_kind", ["USER", "NETWORK"]);
export const rateLimitAction = pgEnum("rate_limit_action", [
  "ONBOARDING",
  "IDENTIFIER_ADD",
  "VERIFICATION_ATTEMPT",
  "ACCOUNT_DELETE",
  "BREACH_SCAN",
]);
export const deliveryChannel = pgEnum("delivery_channel", ["EMAIL"]);
export const deliveryState = pgEnum("delivery_state", [
  "PENDING",
  "CLAIMED",
  "COMPLETED",
  "DEAD_LETTERED",
  "CANCELLED",
]);
export const providerUsageState = pgEnum("provider_usage_state", [
  "RESERVED",
  "COMPLETED",
  "FAILED",
  "RELEASED",
]);
export const scanState = pgEnum("scan_state", [
  "QUEUED",
  "RUNNING",
  "PARTIAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export const scanTrigger = pgEnum("scan_trigger", ["USER"]);
export const providerRunState = pgEnum("provider_run_state", ["RUNNING", "COMPLETED", "FAILED"]);
export const scanJobState = pgEnum("scan_job_state", [
  "PENDING",
  "CLAIMED",
  "COMPLETED",
  "DEAD_LETTERED",
  "CANCELLED",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authSubject: text("auth_subject").notNull(),
    state: accountState("state").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("users_auth_subject_unique").on(table.authSubject),
    pgPolicy("users_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`auth_subject = nullif(current_setting('app.auth_subject', true), '')`,
      withCheck: sql`auth_subject = nullif(current_setting('app.auth_subject', true), '')`,
    }),
    pgPolicy("users_delivery_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_delivery_owner'`,
      withCheck: sql`current_user = 'digital_footprint_delivery_owner'`,
    }),
    pgPolicy("users_rotation_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_rotation_owner'`,
      withCheck: sql`current_user = 'digital_footprint_rotation_owner'`,
    }),
    pgPolicy("users_lookup_rotation_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_lookup_rotation_owner'`,
      withCheck: sql`current_user = 'digital_footprint_lookup_rotation_owner'`,
    }),
    pgPolicy("users_retention_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_retention_owner'`,
      withCheck: sql`current_user = 'digital_footprint_retention_owner'`,
    }),
    pgPolicy("users_provider_usage_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_provider_usage_owner'`,
      withCheck: sql`current_user = 'digital_footprint_provider_usage_owner'`,
    }),
    pgPolicy("users_scan_job_capability", {
      for: "select",
      to: "public",
      using: sql`current_user = 'digital_footprint_provider_usage_owner'`,
    }),
  ],
).enableRLS();

export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("My identity"),
    state: identityState("state").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("one_active_identity_per_user").on(table.userId),
    pgPolicy("identities_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
      withCheck: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
    pgPolicy("identities_rotation_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_rotation_owner'`,
      withCheck: sql`current_user = 'digital_footprint_rotation_owner'`,
    }),
    pgPolicy("identities_lookup_rotation_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_lookup_rotation_owner'`,
      withCheck: sql`current_user = 'digital_footprint_lookup_rotation_owner'`,
    }),
    pgPolicy("identities_retention_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_retention_owner'`,
      withCheck: sql`current_user = 'digital_footprint_retention_owner'`,
    }),
    pgPolicy("identities_delivery_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_delivery_owner'`,
      withCheck: sql`current_user = 'digital_footprint_delivery_owner'`,
    }),
  ],
).enableRLS();

export const identifiers = pgTable(
  "identifiers",
  {
    id: uuid("id").primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    type: identifierType("type").notNull(),
    encryptedValue: jsonb("encrypted_value").$type<EncryptedEnvelope>().notNull(),
    lookupToken: text("lookup_token").notNull(),
    normalizationVersion: text("normalization_version").notNull(),
    verificationStatus: verificationStatus("verification_status").notNull().default("PENDING"),
    sensitivity: sensitivity("sensitivity").notNull(),
    maskedDisplay: text("masked_display").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("identifier_identity_type_lookup_unique").on(
      table.identityId,
      table.type,
      table.lookupToken,
    ),
    unique("identifiers_id_identity_type_unique").on(table.id, table.identityId, table.type),
    index("identifiers_identity_idx").on(table.identityId),
    pgPolicy("identifiers_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`exists (
        select 1 from identities
        inner join users on users.id = identities.user_id
        where identities.id = identity_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
      withCheck: sql`exists (
        select 1 from identities
        inner join users on users.id = identities.user_id
        where identities.id = identity_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
    pgPolicy("identifiers_rotation_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_rotation_owner'`,
      withCheck: sql`current_user = 'digital_footprint_rotation_owner'`,
    }),
    pgPolicy("identifiers_lookup_rotation_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_lookup_rotation_owner'`,
      withCheck: sql`current_user = 'digital_footprint_lookup_rotation_owner'`,
    }),
    pgPolicy("identifiers_retention_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_retention_owner'`,
      withCheck: sql`current_user = 'digital_footprint_retention_owner'`,
    }),
    pgPolicy("identifiers_delivery_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_delivery_owner'`,
      withCheck: sql`current_user = 'digital_footprint_delivery_owner'`,
    }),
  ],
).enableRLS();

export const identifierLookupTokens = pgTable(
  "identifier_lookup_tokens",
  {
    identifierId: uuid("identifier_id").notNull(),
    identityId: uuid("identity_id").notNull(),
    identifierType: identifierType("identifier_type").notNull(),
    namespace: text("namespace").notNull(),
    normalizationVersion: text("normalization_version").notNull(),
    lookupKeyId: text("lookup_key_id").notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.identifierId, table.lookupKeyId] }),
    foreignKey({
      columns: [table.identifierId, table.identityId, table.identifierType],
      foreignColumns: [identifiers.id, identifiers.identityId, identifiers.type],
    }).onDelete("cascade"),
    uniqueIndex("identifier_lookup_tokens_identity_type_key_token_unique").on(
      table.identityId,
      table.identifierType,
      table.lookupKeyId,
      table.token,
    ),
    index("identifier_lookup_tokens_identifier_idx").on(table.identifierId),
    pgPolicy("identifier_lookup_tokens_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`exists (
        select 1 from identities
        inner join users on users.id = identities.user_id
        where identities.id = identity_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
      withCheck: sql`exists (
        select 1 from identities
        inner join users on users.id = identities.user_id
        where identities.id = identity_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
    pgPolicy("identifier_lookup_tokens_lookup_rotation_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_lookup_rotation_owner'`,
      withCheck: sql`current_user = 'digital_footprint_lookup_rotation_owner'`,
    }),
  ],
).enableRLS();

export const identifierVerifications = pgTable(
  "identifier_verifications",
  {
    id: uuid("id").primaryKey(),
    identifierId: uuid("identifier_id")
      .notNull()
      .references(() => identifiers.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    challengeHash: text("challenge_hash").notNull(),
    status: verificationStatus("status").notNull().default("PENDING"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
  },
  (table) => [
    index("verification_identifier_idx").on(table.identifierId),
    pgPolicy("identifier_verifications_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`exists (
        select 1 from identifiers
        inner join identities on identities.id = identifiers.identity_id
        inner join users on users.id = identities.user_id
        where identifiers.id = identifier_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
      withCheck: sql`exists (
        select 1 from identifiers
        inner join identities on identities.id = identifiers.identity_id
        inner join users on users.id = identities.user_id
        where identifiers.id = identifier_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
    pgPolicy("identifier_verifications_retention_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_retention_owner'`,
      withCheck: sql`current_user = 'digital_footprint_retention_owner'`,
    }),
    pgPolicy("identifier_verifications_delivery_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_delivery_owner'`,
      withCheck: sql`current_user = 'digital_footprint_delivery_owner'`,
    }),
  ],
).enableRLS();

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    dataCategories: text("data_categories").array().notNull(),
    policyVersion: text("policy_version").notNull(),
    state: consentState("state").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "consent_state_timestamp_invariant",
      sql`(${table.state} = 'GRANTED' and ${table.withdrawnAt} is null)
        or (${table.state} = 'WITHDRAWN' and ${table.withdrawnAt} is not null and ${table.withdrawnAt} >= ${table.grantedAt})`,
    ),
    uniqueIndex("one_active_breach_consent_per_policy")
      .on(table.userId, table.identityId, table.purpose, table.policyVersion)
      .where(
        sql`${table.state} = 'GRANTED'
          and ${table.purpose} = 'BREACH_METADATA_LOOKUP'
          and ${table.policyVersion} = 'phase2-breach-v1'`,
      ),
    index("consent_user_idx").on(table.userId),
    pgPolicy("consent_records_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`exists (
        select 1 from users
        inner join identities on identities.user_id = users.id
        where users.id = consent_records.user_id
          and identities.id = consent_records.identity_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
      withCheck: sql`exists (
        select 1 from users
        inner join identities on identities.user_id = users.id
        where users.id = consent_records.user_id
          and identities.id = consent_records.identity_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
  ],
).enableRLS();

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    outcome: text("outcome").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_user_time_idx").on(table.userId, table.occurredAt),
    pgPolicy("audit_events_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`user_id is not null and exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
      withCheck: sql`user_id is not null and exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
    pgPolicy("audit_events_retention_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_retention_owner'`,
      withCheck: sql`current_user = 'digital_footprint_retention_owner'`,
    }),
  ],
).enableRLS();

export const deletionReceipts = pgTable(
  "deletion_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectToken: text("subject_token").notNull(),
    subjectTokenKeyId: text("subject_token_key_id"),
    state: deletionState("state").notNull().default("REQUESTED"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    failureCode: text("failure_code"),
  },
  (table) => [
    uniqueIndex("deletion_subject_token_unique").on(table.subjectToken),
    pgPolicy("deletion_receipts_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`subject_token = nullif(current_setting('app.subject_token', true), '')
        or subject_token = nullif(current_setting('app.subject_token_previous', true), '')`,
      withCheck: sql`subject_token = nullif(current_setting('app.subject_token', true), '')
        or subject_token = nullif(current_setting('app.subject_token_previous', true), '')`,
    }),
    pgPolicy("deletion_receipts_retention_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_retention_owner'`,
      withCheck: sql`current_user = 'digital_footprint_retention_owner'`,
    }),
  ],
).enableRLS();

export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    scopeKind: rateLimitScopeKind("scope_kind").notNull(),
    scopeToken: text("scope_token").notNull(),
    action: rateLimitAction("action").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKind, table.scopeToken, table.action] }),
    index("rate_limit_windows_expiry_idx").on(table.expiresAt),
    pgPolicy("rate_limit_windows_rate_limit_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_rate_limit_owner'`,
      withCheck: sql`current_user = 'digital_footprint_rate_limit_owner'`,
    }),
    pgPolicy("rate_limit_windows_retention_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_retention_owner'`,
      withCheck: sql`current_user = 'digital_footprint_retention_owner'`,
    }),
  ],
).enableRLS();

export const providerUsageReservations = pgTable(
  "provider_usage_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    estimatedCostUnits: integer("estimated_cost_units").notNull(),
    actualCostUnits: integer("actual_cost_units"),
    state: providerUsageState("state").notNull().default("RESERVED"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("provider_usage_user_provider_idempotency_unique").on(
      table.userId,
      table.providerId,
      table.idempotencyKey,
    ),
    index("provider_usage_provider_time_idx").on(table.providerId, table.reservedAt),
    index("provider_usage_user_time_idx").on(table.userId, table.reservedAt),
    check(
      "provider_usage_costs_nonnegative",
      sql`${table.estimatedCostUnits} >= 0 AND (${table.actualCostUnits} IS NULL OR ${table.actualCostUnits} BETWEEN 0 AND ${table.estimatedCostUnits})`,
    ),
    check(
      "provider_usage_terminal_invariant",
      sql`(${table.state} = 'RESERVED' AND ${table.actualCostUnits} IS NULL AND ${table.terminalAt} IS NULL)
        OR (${table.state} IN ('COMPLETED', 'FAILED') AND ${table.actualCostUnits} IS NOT NULL AND ${table.terminalAt} IS NOT NULL)
        OR (${table.state} = 'RELEASED' AND ${table.actualCostUnits} IS NULL AND ${table.terminalAt} IS NOT NULL)`,
    ),
    pgPolicy("provider_usage_reservations_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
      withCheck: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
    pgPolicy("provider_usage_reservations_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_provider_usage_owner'`,
      withCheck: sql`current_user = 'digital_footprint_provider_usage_owner'`,
    }),
  ],
).enableRLS();

export const verificationDeliveryOutbox = pgTable(
  "verification_delivery_outbox",
  {
    deliveryId: uuid("delivery_id").primaryKey(),
    verificationId: uuid("verification_id")
      .notNull()
      .references(() => identifierVerifications.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: deliveryChannel("channel").notNull().default("EMAIL"),
    template: text("template").notNull(),
    encryptedPayload: jsonb("encrypted_payload").$type<EncryptedEnvelope>(),
    state: deliveryState("state").notNull().default("PENDING"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("verification_delivery_outbox_verification_idx").on(table.verificationId),
    index("verification_delivery_outbox_claim_idx").on(table.state, table.notBefore),
    index("verification_delivery_outbox_lease_idx").on(table.state, table.leaseExpiresAt),
    check(
      "verification_delivery_outbox_template_allowlist",
      sql`${table.template} IN ('EMAIL_VERIFICATION_CODE_V1')`,
    ),
    check(
      "verification_delivery_outbox_max_attempts_range",
      sql`${table.maxAttempts} BETWEEN 1 AND 20`,
    ),
    check(
      "verification_delivery_outbox_payload_state_invariant",
      sql`(${table.state} IN ('COMPLETED', 'DEAD_LETTERED', 'CANCELLED') AND ${table.encryptedPayload} IS NULL)
        OR (${table.state} IN ('PENDING', 'CLAIMED') AND ${table.encryptedPayload} IS NOT NULL)`,
    ),
    pgPolicy("verification_delivery_outbox_insert_only", {
      for: "insert",
      to: "public",
      withCheck: sql`exists (
        select 1 from identifier_verifications
        inner join identifiers on identifiers.id = identifier_verifications.identifier_id
        inner join identities on identities.id = identifiers.identity_id
        inner join users on users.id = identities.user_id
        where identifier_verifications.id = verification_delivery_outbox.verification_id
          and users.id = verification_delivery_outbox.user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
    pgPolicy("verification_delivery_outbox_delivery_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_delivery_owner'`,
      withCheck: sql`current_user = 'digital_footprint_delivery_owner'`,
    }),
  ],
).enableRLS();

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    trigger: scanTrigger("trigger").notNull().default("USER"),
    state: scanState("state").notNull(),
    requestedCapability: text("requested_capability").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("scans_user_time_idx").on(table.userId, table.startedAt),
    uniqueIndex("one_active_scan_per_user_capability")
      .on(table.userId, table.requestedCapability)
      .where(sql`${table.state} IN ('QUEUED', 'RUNNING')`),
    check(
      "scans_terminal_invariant",
      sql`(${table.state} IN ('QUEUED', 'RUNNING') AND ${table.completedAt} IS NULL)
        OR (${table.state} IN ('PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED')
          AND ${table.completedAt} IS NOT NULL AND ${table.completedAt} >= ${table.startedAt})`,
    ),
    pgPolicy("scans_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
      withCheck: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
    pgPolicy("scans_scan_job_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_provider_usage_owner'`,
      withCheck: sql`current_user = 'digital_footprint_provider_usage_owner'`,
    }),
  ],
).enableRLS();

export const scanJobs = pgTable(
  "scan_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    identifierId: uuid("identifier_id")
      .notNull()
      .references(() => identifiers.id, { onDelete: "cascade" }),
    consentRecordId: uuid("consent_record_id")
      .notNull()
      .references(() => consentRecords.id, { onDelete: "cascade" }),
    state: scanJobState("state").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorSafeCode: text("last_error_safe_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("scan_jobs_scan_unique").on(table.scanId),
    index("scan_jobs_claim_idx").on(table.state, table.notBefore),
    index("scan_jobs_lease_idx").on(table.state, table.leaseExpiresAt),
    check("scan_jobs_attempt_range", sql`${table.attemptCount} BETWEEN 0 AND ${table.maxAttempts}`),
    check("scan_jobs_max_attempts_range", sql`${table.maxAttempts} BETWEEN 1 AND 10`),
    check(
      "scan_jobs_error_safe_code_format",
      sql`${table.lastErrorSafeCode} IS NULL OR ${table.lastErrorSafeCode} ~ '^[A-Z][A-Z0-9_]{0,63}$'`,
    ),
    check(
      "scan_jobs_lease_invariant",
      sql`(${table.state} = 'CLAIMED' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)
        OR (${table.state} <> 'CLAIMED' AND ${table.leaseToken} IS NULL AND ${table.leaseExpiresAt} IS NULL)`,
    ),
    pgPolicy("scan_jobs_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
      withCheck: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
    pgPolicy("scan_jobs_scan_job_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_provider_usage_owner'`,
      withCheck: sql`current_user = 'digital_footprint_provider_usage_owner'`,
    }),
    pgPolicy("scan_jobs_retention_capability", {
      for: "all",
      to: "public",
      using: sql`current_user = 'digital_footprint_retention_owner'`,
      withCheck: sql`current_user = 'digital_footprint_retention_owner'`,
    }),
  ],
).enableRLS();

export const providerRuns = pgTable(
  "provider_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    capability: text("capability").notNull(),
    reservationId: uuid("reservation_id").references(() => providerUsageReservations.id, {
      onDelete: "set null",
    }),
    state: providerRunState("state").notNull(),
    healthOutcome: text("health_outcome"),
    resultCount: integer("result_count"),
    errorSafeCode: text("error_safe_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("provider_runs_scan_idx").on(table.scanId),
    index("provider_runs_user_time_idx").on(table.userId, table.startedAt),
    check(
      "provider_runs_provider_id_format",
      sql`${table.providerId} ~ '^[a-z0-9][a-z0-9-]{0,63}$'`,
    ),
    check(
      "provider_runs_error_safe_code_format",
      sql`${table.errorSafeCode} IS NULL OR ${table.errorSafeCode} ~ '^[A-Z][A-Z0-9_]{0,63}$'`,
    ),
    check(
      "provider_runs_terminal_invariant",
      sql`(${table.state} = 'RUNNING' AND ${table.healthOutcome} IS NULL
          AND ${table.resultCount} IS NULL AND ${table.errorSafeCode} IS NULL AND ${table.finishedAt} IS NULL)
        OR (${table.state} = 'COMPLETED' AND ${table.finishedAt} IS NOT NULL
          AND ${table.resultCount} IS NOT NULL AND ${table.errorSafeCode} IS NULL)
        OR (${table.state} = 'FAILED' AND ${table.finishedAt} IS NOT NULL
          AND ${table.errorSafeCode} IS NOT NULL AND ${table.resultCount} IS NULL)`,
    ),
    pgPolicy("provider_runs_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
      withCheck: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
  ],
).enableRLS();

export const breachFindings = pgTable(
  "breach_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerRunId: uuid("provider_run_id")
      .notNull()
      .references(() => providerRuns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    providerBreachId: text("provider_breach_id").notNull(),
    breachName: text("breach_name").notNull(),
    breachDate: date("breach_date").notNull(),
    providerAddedAt: timestamp("provider_added_at", { withTimezone: true }).notNull(),
    providerModifiedAt: timestamp("provider_modified_at", { withTimezone: true }).notNull(),
    dataCategories: text("data_categories").array().notNull(),
    isVerified: boolean("is_verified").notNull(),
    isSensitive: boolean("is_sensitive").notNull(),
    isRetired: boolean("is_retired").notNull(),
    sourceUrl: text("source_url").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    parserVersion: text("parser_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("breach_findings_provider_run_idx").on(table.providerRunId),
    index("breach_findings_user_time_idx").on(table.userId, table.checkedAt),
    check(
      "breach_findings_breach_name_length",
      sql`char_length(${table.breachName}) BETWEEN 1 AND 200`,
    ),
    check(
      "breach_findings_data_categories_nonempty",
      sql`array_length(${table.dataCategories}, 1) >= 1`,
    ),
    check("breach_findings_source_url_scheme", sql`${table.sourceUrl} ~ '^https://'`),
    pgPolicy("breach_findings_tenant_isolation", {
      for: "all",
      to: "public",
      using: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
      withCheck: sql`exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )`,
    }),
  ],
).enableRLS();

import type { EncryptedEnvelope } from "@/security/crypto";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
  ],
).enableRLS();

export const deletionReceipts = pgTable(
  "deletion_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectToken: text("subject_token").notNull(),
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
      using: sql`subject_token = nullif(current_setting('app.subject_token', true), '')`,
      withCheck: sql`subject_token = nullif(current_setting('app.subject_token', true), '')`,
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
  ],
).enableRLS();

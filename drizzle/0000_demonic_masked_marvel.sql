CREATE TYPE "public"."account_state" AS ENUM('ACTIVE', 'DELETION_PENDING');--> statement-breakpoint
CREATE TYPE "public"."consent_state" AS ENUM('GRANTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."deletion_state" AS ENUM('REQUESTED', 'AUTH_REVOKED', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."identifier_type" AS ENUM('EMAIL', 'USERNAME', 'PHONE', 'FULL_NAME', 'ALIAS', 'DOMAIN', 'WEBSITE', 'SOCIAL_PROFILE', 'ORGANIZATION', 'LOCATION');--> statement-breakpoint
CREATE TYPE "public"."identity_state" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."sensitivity" AS ENUM('PUBLIC', 'LOW', 'MODERATE', 'SENSITIVE', 'HIGHLY_SENSITIVE');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('UNVERIFIED', 'PENDING', 'VERIFIED', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"outcome" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"data_categories" text[] NOT NULL,
	"policy_version" text NOT NULL,
	"state" "consent_state" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deletion_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_token" text NOT NULL,
	"state" "deletion_state" DEFAULT 'REQUESTED' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"failure_code" text
);
--> statement-breakpoint
CREATE TABLE "identifier_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier_id" uuid NOT NULL,
	"method" text NOT NULL,
	"challenge_hash" text NOT NULL,
	"status" "verification_status" DEFAULT 'PENDING' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identifiers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identity_id" uuid NOT NULL,
	"type" "identifier_type" NOT NULL,
	"encrypted_value" jsonb NOT NULL,
	"lookup_token" text NOT NULL,
	"normalization_version" text NOT NULL,
	"verification_status" "verification_status" DEFAULT 'PENDING' NOT NULL,
	"sensitivity" "sensitivity" NOT NULL,
	"masked_display" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text DEFAULT 'My identity' NOT NULL,
	"state" "identity_state" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_subject" text NOT NULL,
	"state" "account_state" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deletion_requested_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identifier_verifications" ADD CONSTRAINT "identifier_verifications_identifier_id_identifiers_id_fk" FOREIGN KEY ("identifier_id") REFERENCES "public"."identifiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identifiers" ADD CONSTRAINT "identifiers_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_user_time_idx" ON "audit_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "consent_user_idx" ON "consent_records" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_subject_token_unique" ON "deletion_receipts" USING btree ("subject_token");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "identifier_verifications" USING btree ("identifier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identifier_identity_type_lookup_unique" ON "identifiers" USING btree ("identity_id","type","lookup_token");--> statement-breakpoint
CREATE INDEX "identifiers_identity_idx" ON "identifiers" USING btree ("identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_identity_per_user" ON "identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_subject_unique" ON "users" USING btree ("auth_subject");
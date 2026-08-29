CREATE TYPE "public"."finding_presence_state" AS ENUM('PRESENT', 'MISSING', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('NEW', 'REVIEWED', 'CONFIRMED', 'FALSE_POSITIVE', 'IGNORED', 'REMEDIATION_IN_PROGRESS', 'RESOLVED', 'REAPPEARED');--> statement-breakpoint
CREATE TYPE "public"."finding_type" AS ENUM('WEB_MENTION', 'SOCIAL_PROFILE', 'EMAIL_EXPOSURE', 'PHONE_EXPOSURE', 'ADDRESS_EXPOSURE', 'DATA_BROKER_PROFILE', 'BREACH', 'DOMAIN_EXPOSURE', 'PUBLIC_DOCUMENT', 'USERNAME_MATCH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."observation_presence" AS ENUM('PRESENT', 'MISSING', 'INDETERMINATE');--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"matched_identifier_id" uuid,
	"type" "finding_type" NOT NULL,
	"source_provider_id" text NOT NULL,
	"title" text NOT NULL,
	"normalized_host" text NOT NULL,
	"provider_external_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"fingerprint_version" text NOT NULL,
	"presence_state" "finding_presence_state" DEFAULT 'PRESENT' NOT NULL,
	"status" "finding_status" DEFAULT 'NEW' NOT NULL,
	"consecutive_absences" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "findings_fingerprint_format" CHECK ("findings"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "findings_fingerprint_version_format" CHECK ("findings"."fingerprint_version" ~ '^v[0-9]{1,3}$'),
	CONSTRAINT "findings_absences_range" CHECK ("findings"."consecutive_absences" BETWEEN 0 AND 1000),
	CONSTRAINT "findings_provider_id_format" CHECK ("findings"."source_provider_id" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
	CONSTRAINT "findings_seen_invariant" CHECK (("findings"."presence_state" = 'PRESENT' AND "findings"."last_seen_at" IS NOT NULL)
        OR "findings"."presence_state" <> 'PRESENT'),
	CONSTRAINT "findings_checked_after_first_seen" CHECK ("findings"."last_checked_at" >= "findings"."first_seen_at")
);
--> statement-breakpoint
ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_run_id" uuid NOT NULL,
	"presence" "observation_presence" NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source_date" date,
	"content_fingerprint" text NOT NULL,
	"parser_version" text NOT NULL,
	"previous_observation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observations_fingerprint_format" CHECK ("observations"."content_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "observations_not_self_referential" CHECK ("observations"."previous_observation_id" <> "observations"."id")
);
--> statement-breakpoint
ALTER TABLE "observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_matched_identifier_id_identifiers_id_fk" FOREIGN KEY ("matched_identifier_id") REFERENCES "public"."identifiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_provider_run_id_provider_runs_id_fk" FOREIGN KEY ("provider_run_id") REFERENCES "public"."provider_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_previous_observation_fk" FOREIGN KEY ("previous_observation_id") REFERENCES "public"."observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "findings_tenant_fingerprint_unique" ON "findings" USING btree ("user_id","fingerprint","fingerprint_version");--> statement-breakpoint
CREATE INDEX "findings_user_state_idx" ON "findings" USING btree ("user_id","presence_state");--> statement-breakpoint
CREATE INDEX "findings_user_checked_idx" ON "findings" USING btree ("user_id","last_checked_at");--> statement-breakpoint
CREATE INDEX "observations_finding_time_idx" ON "observations" USING btree ("finding_id","observed_at");--> statement-breakpoint
CREATE INDEX "observations_user_time_idx" ON "observations" USING btree ("user_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_run_finding_unique" ON "observations" USING btree ("provider_run_id","finding_id");--> statement-breakpoint
CREATE POLICY "findings_tenant_isolation" ON "findings" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint
CREATE POLICY "observations_tenant_isolation" ON "observations" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint
ALTER TABLE "findings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "observations" FORCE ROW LEVEL SECURITY;

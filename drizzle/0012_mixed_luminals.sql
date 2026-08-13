CREATE TYPE "public"."delivery_channel" AS ENUM('EMAIL');--> statement-breakpoint
CREATE TYPE "public"."delivery_state" AS ENUM('PENDING', 'CLAIMED', 'COMPLETED', 'DEAD_LETTERED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "verification_delivery_outbox" (
	"delivery_id" uuid PRIMARY KEY NOT NULL,
	"verification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "delivery_channel" DEFAULT 'EMAIL' NOT NULL,
	"template" text NOT NULL,
	"encrypted_payload" jsonb,
	"state" "delivery_state" DEFAULT 'PENDING' NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_delivery_outbox_template_allowlist" CHECK ("verification_delivery_outbox"."template" IN ('EMAIL_VERIFICATION_CODE_V1')),
	CONSTRAINT "verification_delivery_outbox_max_attempts_range" CHECK ("verification_delivery_outbox"."max_attempts" BETWEEN 1 AND 20),
	CONSTRAINT "verification_delivery_outbox_payload_state_invariant" CHECK (("verification_delivery_outbox"."state" IN ('COMPLETED', 'DEAD_LETTERED', 'CANCELLED') AND "verification_delivery_outbox"."encrypted_payload" IS NULL)
        OR ("verification_delivery_outbox"."state" IN ('PENDING', 'CLAIMED') AND "verification_delivery_outbox"."encrypted_payload" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "verification_delivery_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verification_delivery_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verification_delivery_outbox" ADD CONSTRAINT "verification_delivery_outbox_verification_id_identifier_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."identifier_verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_delivery_outbox" ADD CONSTRAINT "verification_delivery_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_delivery_outbox_verification_idx" ON "verification_delivery_outbox" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "verification_delivery_outbox_claim_idx" ON "verification_delivery_outbox" USING btree ("state","not_before");--> statement-breakpoint
CREATE INDEX "verification_delivery_outbox_lease_idx" ON "verification_delivery_outbox" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE POLICY "verification_delivery_outbox_insert_only" ON "verification_delivery_outbox" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from identifier_verifications
        inner join identifiers on identifiers.id = identifier_verifications.identifier_id
        inner join identities on identities.id = identifiers.identity_id
        inner join users on users.id = identities.user_id
        where identifier_verifications.id = verification_delivery_outbox.verification_id
          and users.id = verification_delivery_outbox.user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));
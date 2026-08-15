ALTER TABLE "consent_records" ADD CONSTRAINT "consent_state_timestamp_invariant" CHECK (("consent_records"."state" = 'GRANTED' and "consent_records"."withdrawn_at" is null)
        or ("consent_records"."state" = 'WITHDRAWN' and "consent_records"."withdrawn_at" is not null and "consent_records"."withdrawn_at" >= "consent_records"."granted_at"));--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_breach_consent_per_policy" ON "consent_records" USING btree ("user_id","identity_id","purpose","policy_version") WHERE "consent_records"."state" = 'GRANTED'
          and "consent_records"."purpose" = 'BREACH_METADATA_LOOKUP'
          and "consent_records"."policy_version" = 'phase2-breach-v1';

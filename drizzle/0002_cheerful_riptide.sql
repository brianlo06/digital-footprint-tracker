ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deletion_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identifier_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identifiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consent_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deletion_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identifier_verifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identifiers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_events_tenant_isolation" ON "audit_events" AS PERMISSIVE FOR ALL TO public USING (user_id is not null and exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (user_id is not null and exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint
CREATE POLICY "consent_records_tenant_isolation" ON "consent_records" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from users
        inner join identities on identities.user_id = users.id
        where users.id = consent_records.user_id
          and identities.id = consent_records.identity_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (exists (
        select 1 from users
        inner join identities on identities.user_id = users.id
        where users.id = consent_records.user_id
          and identities.id = consent_records.identity_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint
CREATE POLICY "deletion_receipts_tenant_isolation" ON "deletion_receipts" AS PERMISSIVE FOR ALL TO public USING (subject_token = nullif(current_setting('app.subject_token', true), '')) WITH CHECK (subject_token = nullif(current_setting('app.subject_token', true), ''));--> statement-breakpoint
CREATE POLICY "identifier_verifications_tenant_isolation" ON "identifier_verifications" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from identifiers
        inner join identities on identities.id = identifiers.identity_id
        inner join users on users.id = identities.user_id
        where identifiers.id = identifier_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (exists (
        select 1 from identifiers
        inner join identities on identities.id = identifiers.identity_id
        inner join users on users.id = identities.user_id
        where identifiers.id = identifier_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint
CREATE POLICY "identifiers_tenant_isolation" ON "identifiers" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from identities
        inner join users on users.id = identities.user_id
        where identities.id = identity_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (exists (
        select 1 from identities
        inner join users on users.id = identities.user_id
        where identities.id = identity_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint
CREATE POLICY "identities_tenant_isolation" ON "identities" AS PERMISSIVE FOR ALL TO public USING (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      )) WITH CHECK (exists (
        select 1 from users
        where users.id = user_id
          and users.auth_subject = nullif(current_setting('app.auth_subject', true), '')
      ));--> statement-breakpoint
CREATE POLICY "users_tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING (auth_subject = nullif(current_setting('app.auth_subject', true), '')) WITH CHECK (auth_subject = nullif(current_setting('app.auth_subject', true), ''));

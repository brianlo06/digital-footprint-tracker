-- Keep security-definer capability owners portable to managed PostgreSQL
-- services that reserve BYPASSRLS for their true superuser. Every policy is
-- bound to one fixed non-login role; table grants still restrict the exact
-- commands that role may perform.
CREATE POLICY "users_delivery_capability" ON "users" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_delivery_owner')
WITH CHECK (current_user = 'digital_footprint_delivery_owner');--> statement-breakpoint
CREATE POLICY "identifiers_rotation_capability" ON "identifiers" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_rotation_owner')
WITH CHECK (current_user = 'digital_footprint_rotation_owner');--> statement-breakpoint
CREATE POLICY "identifiers_lookup_rotation_capability" ON "identifiers" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_lookup_rotation_owner')
WITH CHECK (current_user = 'digital_footprint_lookup_rotation_owner');--> statement-breakpoint
CREATE POLICY "identifier_lookup_tokens_lookup_rotation_capability" ON "identifier_lookup_tokens" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_lookup_rotation_owner')
WITH CHECK (current_user = 'digital_footprint_lookup_rotation_owner');--> statement-breakpoint
CREATE POLICY "identifier_verifications_retention_capability" ON "identifier_verifications" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_retention_owner')
WITH CHECK (current_user = 'digital_footprint_retention_owner');--> statement-breakpoint
CREATE POLICY "identifier_verifications_delivery_capability" ON "identifier_verifications" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_delivery_owner')
WITH CHECK (current_user = 'digital_footprint_delivery_owner');--> statement-breakpoint
CREATE POLICY "audit_events_retention_capability" ON "audit_events" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_retention_owner')
WITH CHECK (current_user = 'digital_footprint_retention_owner');--> statement-breakpoint
CREATE POLICY "deletion_receipts_retention_capability" ON "deletion_receipts" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_retention_owner')
WITH CHECK (current_user = 'digital_footprint_retention_owner');--> statement-breakpoint
CREATE POLICY "rate_limit_windows_rate_limit_capability" ON "rate_limit_windows" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_rate_limit_owner')
WITH CHECK (current_user = 'digital_footprint_rate_limit_owner');--> statement-breakpoint
CREATE POLICY "rate_limit_windows_retention_capability" ON "rate_limit_windows" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_retention_owner')
WITH CHECK (current_user = 'digital_footprint_retention_owner');--> statement-breakpoint
CREATE POLICY "verification_delivery_outbox_delivery_capability" ON "verification_delivery_outbox" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_delivery_owner')
WITH CHECK (current_user = 'digital_footprint_delivery_owner');

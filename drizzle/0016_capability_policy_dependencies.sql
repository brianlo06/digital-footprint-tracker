-- PostgreSQL checks privileges for relations referenced by every applicable
-- RLS policy expression. These fixed-role policies let non-login capability
-- owners evaluate tenant-policy joins without granting any Worker login role
-- direct table access. Provisioning separately supplies read-only ACLs.
CREATE POLICY "users_rotation_capability" ON "users" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_rotation_owner')
WITH CHECK (current_user = 'digital_footprint_rotation_owner');--> statement-breakpoint
CREATE POLICY "users_lookup_rotation_capability" ON "users" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_lookup_rotation_owner')
WITH CHECK (current_user = 'digital_footprint_lookup_rotation_owner');--> statement-breakpoint
CREATE POLICY "users_retention_capability" ON "users" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_retention_owner')
WITH CHECK (current_user = 'digital_footprint_retention_owner');--> statement-breakpoint
CREATE POLICY "identities_rotation_capability" ON "identities" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_rotation_owner')
WITH CHECK (current_user = 'digital_footprint_rotation_owner');--> statement-breakpoint
CREATE POLICY "identities_lookup_rotation_capability" ON "identities" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_lookup_rotation_owner')
WITH CHECK (current_user = 'digital_footprint_lookup_rotation_owner');--> statement-breakpoint
CREATE POLICY "identities_retention_capability" ON "identities" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_retention_owner')
WITH CHECK (current_user = 'digital_footprint_retention_owner');--> statement-breakpoint
CREATE POLICY "identities_delivery_capability" ON "identities" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_delivery_owner')
WITH CHECK (current_user = 'digital_footprint_delivery_owner');--> statement-breakpoint
CREATE POLICY "identifiers_retention_capability" ON "identifiers" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_retention_owner')
WITH CHECK (current_user = 'digital_footprint_retention_owner');--> statement-breakpoint
CREATE POLICY "identifiers_delivery_capability" ON "identifiers" AS PERMISSIVE FOR ALL TO public
USING (current_user = 'digital_footprint_delivery_owner')
WITH CHECK (current_user = 'digital_footprint_delivery_owner');

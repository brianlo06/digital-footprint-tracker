CREATE TABLE "identifier_lookup_tokens" (
	"identifier_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"identifier_type" "identifier_type" NOT NULL,
	"namespace" text NOT NULL,
	"normalization_version" text NOT NULL,
	"lookup_key_id" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identifier_lookup_tokens_identifier_id_lookup_key_id_pk" PRIMARY KEY("identifier_id","lookup_key_id")
);
--> statement-breakpoint
ALTER TABLE "identifier_lookup_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identifier_lookup_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deletion_receipts" ADD COLUMN "subject_token_key_id" text;--> statement-breakpoint
ALTER TABLE "identifiers" ADD CONSTRAINT "identifiers_id_identity_type_unique" UNIQUE("id","identity_id","type");--> statement-breakpoint
ALTER TABLE "identifier_lookup_tokens" ADD CONSTRAINT "identifier_lookup_tokens_identifier_id_identity_id_identifier_type_identifiers_id_identity_id_type_fk" FOREIGN KEY ("identifier_id","identity_id","identifier_type") REFERENCES "public"."identifiers"("id","identity_id","type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identifier_lookup_tokens_identity_type_key_token_unique" ON "identifier_lookup_tokens" USING btree ("identity_id","identifier_type","lookup_key_id","token");--> statement-breakpoint
CREATE INDEX "identifier_lookup_tokens_identifier_idx" ON "identifier_lookup_tokens" USING btree ("identifier_id");--> statement-breakpoint
CREATE POLICY "identifier_lookup_tokens_tenant_isolation" ON "identifier_lookup_tokens" AS PERMISSIVE FOR ALL TO public USING (exists (
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
ALTER POLICY "deletion_receipts_tenant_isolation" ON "deletion_receipts" TO public USING (subject_token = nullif(current_setting('app.subject_token', true), '')
        or subject_token = nullif(current_setting('app.subject_token_previous', true), '')) WITH CHECK (subject_token = nullif(current_setting('app.subject_token', true), '')
        or subject_token = nullif(current_setting('app.subject_token_previous', true), ''));
CREATE TYPE "public"."rate_limit_action" AS ENUM('ONBOARDING', 'IDENTIFIER_ADD', 'VERIFICATION_ATTEMPT', 'ACCOUNT_DELETE');--> statement-breakpoint
CREATE TYPE "public"."rate_limit_scope_kind" AS ENUM('USER', 'NETWORK');--> statement-breakpoint
CREATE TABLE "rate_limit_windows" (
	"scope_kind" "rate_limit_scope_kind" NOT NULL,
	"scope_token" text NOT NULL,
	"action" "rate_limit_action" NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer NOT NULL,
	"blocked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_windows_scope_kind_scope_token_action_pk" PRIMARY KEY("scope_kind","scope_token","action")
);
--> statement-breakpoint
ALTER TABLE "rate_limit_windows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rate_limit_windows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "rate_limit_windows_expiry_idx" ON "rate_limit_windows" USING btree ("expires_at");

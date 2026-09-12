ALTER TABLE "zhihu_accounts" ADD COLUMN "sync_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zhihu_accounts" ADD COLUMN "last_sync_at" timestamp with time zone;
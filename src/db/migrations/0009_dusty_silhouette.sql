CREATE TABLE "zhihu_oauth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"state_hash" text NOT NULL,
	"browser_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "zhihu_oauth_attempts_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
ALTER TABLE "zhihu_oauth_attempts" ADD CONSTRAINT "zhihu_oauth_attempts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zhihu_oauth_attempts_expiry_idx" ON "zhihu_oauth_attempts" USING btree ("expires_at");
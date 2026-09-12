ALTER TABLE "zhihu_oauth_attempts" ADD COLUMN "completed_user_id" uuid;--> statement-breakpoint
ALTER TABLE "zhihu_oauth_attempts" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zhihu_oauth_attempts" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zhihu_oauth_attempts" ADD CONSTRAINT "zhihu_oauth_attempts_completed_user_id_users_id_fk" FOREIGN KEY ("completed_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "consents" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "followup_versions" ADD COLUMN "snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "followup_versions" ADD COLUMN "interview_id" uuid;--> statement-breakpoint
ALTER TABLE "interview_messages" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "followup_versions" ADD CONSTRAINT "followup_versions_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_versions" ADD CONSTRAINT "followup_versions_interview_id_interview_sessions_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE set null ON UPDATE no action;
CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'ai');--> statement-breakpoint
CREATE TYPE "public"."ai_task" AS ENUM('ai_a_extract', 'ai_b_interview', 'ai_c_draft', 'ai_d_val');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('candidate', 'hold', 'eligible', 'invite_recorded', 'accepted', 'declined', 'expired', 'interviewing', 'paused', 'draft', 'stopped', 'confirmed', 'published', 'withdrawn', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('private_interview', 'external_model_processing', 'demo_public_display', 'video_display', 'experience_index', 'model_training');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."deletion_scope" AS ENUM('user', 'source', 'case', 'followup');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."followup_version_status" AS ENUM('draft', 'confirmed', 'published', 'withdrawn', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."generated_by" AS ENUM('ai', 'manual', 'fallback_form');--> statement-breakpoint
CREATE TYPE "public"."interview_message_role" AS ENUM('ai', 'author', 'system');--> statement-breakpoint
CREATE TYPE "public"."interview_mode" AS ENUM('ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."interview_session_status" AS ENUM('active', 'paused', 'finished', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."invitation_channel" AS ENUM('manual', 'email', 'other');--> statement-breakpoint
CREATE TYPE "public"."invitation_result" AS ENUM('pending', 'no_response_in_window', 'replied', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."launch_type" AS ENUM('reader_initiated', 'author_initiated', 'pilot_preauthorized');--> statement-breakpoint
CREATE TYPE "public"."login_token_purpose" AS ENUM('bootstrap', 'invitation', 'author_binding');--> statement-breakpoint
CREATE TYPE "public"."material_level" AS ENUM('exact_excerpt', 'api_summary', 'author_recollection', 'ai_summary');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('unread', 'read', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."permission_status" AS ENUM('pending', 'private_only', 'public_approved', 'revoked', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('official_search', 'author_paste', 'researcher_import', 'third_party_link');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('reader', 'author', 'researcher', 'admin');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('oauth', 'manual');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" "ai_task" NOT NULL,
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"job_id" uuid,
	"case_id" uuid,
	"source_id" uuid,
	"interview_session_id" uuid,
	"model_id" text,
	"prompt_version" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"cost_usd" numeric(12, 6),
	"request_id" text,
	"error_code" text,
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_type" "actor_type" DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"case_id" uuid,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "author_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"method" "verification_method" NOT NULL,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"evidence_ref" text,
	"verifier_user_id" uuid,
	"scope" text,
	"notes" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid,
	"purpose" "consent_purpose" NOT NULL,
	"status" "consent_status" DEFAULT 'granted' NOT NULL,
	"version" text DEFAULT 'v1' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "deletion_scope" NOT NULL,
	"subject_id" text NOT NULL,
	"subject_user_id" uuid,
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"reason" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_by_user_id" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "followup_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"author_user_id" uuid,
	"status" "case_status" DEFAULT 'candidate' NOT NULL,
	"launch_type" "launch_type" DEFAULT 'reader_initiated' NOT NULL,
	"decline_flag" boolean DEFAULT false NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"reviewer_required" boolean DEFAULT false NOT NULL,
	"published_version_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followup_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "followup_version_status" DEFAULT 'draft' NOT NULL,
	"statements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unresolved_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_edits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_confirmations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"ai_assisted" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"user_id" uuid,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reader_key" text NOT NULL,
	"source_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"cohort" text DEFAULT 'unassigned' NOT NULL,
	"triggered_by" text DEFAULT 'natural' NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "interview_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "interview_message_role" NOT NULL,
	"sequence" integer NOT NULL,
	"question" text,
	"purpose" text,
	"basis_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_message" text,
	"skipped" boolean DEFAULT false NOT NULL,
	"stop_reason" text,
	"generated_by" "generated_by" DEFAULT 'manual' NOT NULL,
	"client_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"mode" "interview_mode" DEFAULT 'ai' NOT NULL,
	"status" "interview_session_status" DEFAULT 'active' NOT NULL,
	"budget_main_questions" integer DEFAULT 5 NOT NULL,
	"questions_asked" integer DEFAULT 0 NOT NULL,
	"stop_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"channel" "invitation_channel" DEFAULT 'manual' NOT NULL,
	"sent_by_user_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observation_deadline" timestamp with time zone,
	"result" "invitation_result" DEFAULT 'pending' NOT NULL,
	"consent_version" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" "execution_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"fencing_token" bigint DEFAULT 0 NOT NULL,
	"dedupe_key" text,
	"result" jsonb,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"purpose" "login_token_purpose" DEFAULT 'bootstrap' NOT NULL,
	"case_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reader_key" text NOT NULL,
	"case_id" uuid NOT NULL,
	"followup_version_id" uuid NOT NULL,
	"status" "notification_status" DEFAULT 'unread' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"fencing_token" bigint DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "research_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"cohort" text DEFAULT 'unassigned' NOT NULL,
	"reader_key" text,
	"source_id" uuid,
	"case_id" uuid,
	"followup_version_id" uuid,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"cohort" text DEFAULT 'unassigned' NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"material_level" "material_level" NOT NULL,
	"body" text,
	"excerpt" text,
	"excerpt_location" text,
	"content_hash" text NOT NULL,
	"published_at" timestamp with time zone,
	"upstream_updated_at" timestamp with time zone,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "source_type" NOT NULL,
	"original_url" text,
	"original_account_ref" text,
	"title" text,
	"permission_status" "permission_status" DEFAULT 'pending' NOT NULL,
	"provenance" text DEFAULT 'test_fixture' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "user_role" DEFAULT 'reader' NOT NULL,
	"cohort" text DEFAULT 'unassigned' NOT NULL,
	"display_name" text,
	"email" text,
	"external_account_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'worker' NOT NULL,
	"version" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_case_id_followup_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."followup_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_interview_session_id_interview_sessions_id_fk" FOREIGN KEY ("interview_session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_case_id_followup_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."followup_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "author_verifications" ADD CONSTRAINT "author_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "author_verifications" ADD CONSTRAINT "author_verifications_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "author_verifications" ADD CONSTRAINT "author_verifications_verifier_user_id_users_id_fk" FOREIGN KEY ("verifier_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_jobs" ADD CONSTRAINT "deletion_jobs_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_jobs" ADD CONSTRAINT "deletion_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_cases" ADD CONSTRAINT "followup_cases_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_cases" ADD CONSTRAINT "followup_cases_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_cases" ADD CONSTRAINT "followup_cases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_versions" ADD CONSTRAINT "followup_versions_case_id_followup_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."followup_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_versions" ADD CONSTRAINT "followup_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_messages" ADD CONSTRAINT "interview_messages_session_id_interview_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_case_id_followup_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."followup_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_case_id_followup_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."followup_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_tokens" ADD CONSTRAINT "login_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_tokens" ADD CONSTRAINT "login_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_case_id_followup_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."followup_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_followup_version_id_followup_versions_id_fk" FOREIGN KEY ("followup_version_id") REFERENCES "public"."followup_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_events" ADD CONSTRAINT "research_events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_events" ADD CONSTRAINT "research_events_case_id_followup_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."followup_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_events" ADD CONSTRAINT "research_events_followup_version_id_followup_versions_id_fk" FOREIGN KEY ("followup_version_id") REFERENCES "public"."followup_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_task_status_idx" ON "ai_runs" USING btree ("task","status");--> statement-breakpoint
CREATE INDEX "ai_runs_case_idx" ON "ai_runs" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_subject_idx" ON "audit_logs" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "author_verifications_source_idx" ON "author_verifications" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "author_verifications_user_idx" ON "author_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_user_source_purpose_version_uq" ON "consents" USING btree ("user_id","source_id","purpose","version");--> statement-breakpoint
CREATE INDEX "consents_source_idx" ON "consents" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "deletion_jobs_status_idx" ON "deletion_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "followup_cases_source_idx" ON "followup_cases" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "followup_cases_author_idx" ON "followup_cases" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "followup_cases_status_idx" ON "followup_cases" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "followup_versions_case_version_uq" ON "followup_versions" USING btree ("case_id","version");--> statement-breakpoint
CREATE INDEX "followup_versions_case_status_idx" ON "followup_versions" USING btree ("case_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key_uq" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE UNIQUE INDEX "interests_reader_source_uq" ON "interests" USING btree ("reader_key","source_id");--> statement-breakpoint
CREATE INDEX "interests_source_active_idx" ON "interests" USING btree ("source_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_messages_session_seq_uq" ON "interview_messages" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_messages_client_id_uq" ON "interview_messages" USING btree ("session_id","client_message_id") WHERE "interview_messages"."client_message_id" is not null;--> statement-breakpoint
CREATE INDEX "interview_sessions_case_idx" ON "interview_sessions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "interview_sessions_owner_idx" ON "interview_sessions" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_sessions_case_active_uq" ON "interview_sessions" USING btree ("case_id") WHERE "interview_sessions"."status" in ('active','paused');--> statement-breakpoint
CREATE INDEX "invitations_case_idx" ON "invitations" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "invitations_result_idx" ON "invitations" USING btree ("result");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE INDEX "jobs_lease_idx" ON "jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_active_uq" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."dedupe_key" is not null and "jobs"."status" in ('queued','running');--> statement-breakpoint
CREATE UNIQUE INDEX "login_tokens_token_hash_uq" ON "login_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "login_tokens_user_idx" ON "login_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_reader_version_uq" ON "notifications" USING btree ("reader_key","followup_version_id");--> statement-breakpoint
CREATE INDEX "notifications_reader_status_idx" ON "notifications" USING btree ("reader_key","status");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_topic_dedupe_uq" ON "outbox" USING btree ("topic","dedupe_key");--> statement-breakpoint
CREATE INDEX "outbox_claim_idx" ON "outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "research_events_type_idx" ON "research_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "research_events_cohort_idx" ON "research_events" USING btree ("cohort");--> statement-breakpoint
CREATE INDEX "research_events_occurred_idx" ON "research_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_active_idx" ON "sessions" USING btree ("expires_at") WHERE "sessions"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "source_snapshots_source_version_uq" ON "source_snapshots" USING btree ("source_id","version");--> statement-breakpoint
CREATE INDEX "source_snapshots_source_idx" ON "source_snapshots" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "sources_permission_idx" ON "sources" USING btree ("permission_status");--> statement-breakpoint
CREATE INDEX "sources_provenance_idx" ON "sources" USING btree ("provenance");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email") WHERE "users"."email" is not null;--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_cohort_idx" ON "users" USING btree ("cohort");
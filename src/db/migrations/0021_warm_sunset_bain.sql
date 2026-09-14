CREATE TABLE "site_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_key" text NOT NULL,
	"user_id" uuid,
	"page" text NOT NULL,
	"source_id" uuid,
	"followup_id" uuid,
	"dwell_ms" integer DEFAULT 0 NOT NULL,
	"client_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_followup_id_followup_versions_id_fk" FOREIGN KEY ("followup_id") REFERENCES "public"."followup_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_visits_event_uq" ON "site_visits" USING btree ("client_event_id");--> statement-breakpoint
CREATE INDEX "site_visits_visitor_idx" ON "site_visits" USING btree ("visitor_key");--> statement-breakpoint
CREATE INDEX "site_visits_source_idx" ON "site_visits" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "site_visits_created_idx" ON "site_visits" USING btree ("created_at");
CREATE TABLE "zhihu_comment_syncs" (
	"source_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"offset" text DEFAULT '0' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_end" boolean DEFAULT false NOT NULL,
	"stopped_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zhihu_comment_syncs" ADD CONSTRAINT "zhihu_comment_syncs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
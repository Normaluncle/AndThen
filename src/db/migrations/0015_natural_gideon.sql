CREATE TABLE "site_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_message_id" uuid NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"page" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_comments" ADD COLUMN "reply_to" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "site_feedback_message_uq" ON "site_feedback" USING btree ("client_message_id");
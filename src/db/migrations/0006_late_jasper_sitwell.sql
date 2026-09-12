CREATE TABLE "author_memories" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"generation" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'empty' NOT NULL,
	"records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_hash" text,
	"error_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

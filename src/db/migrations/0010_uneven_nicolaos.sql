CREATE TABLE "zhihu_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"display_name" text,
	"token_ciphertext" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zhihu_accounts_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
ALTER TABLE "zhihu_accounts" ADD CONSTRAINT "zhihu_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
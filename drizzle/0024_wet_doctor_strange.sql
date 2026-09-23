ALTER TABLE "account_person" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "account_person" ADD COLUMN "posts_json" jsonb;--> statement-breakpoint
ALTER TABLE "account_person" ADD COLUMN "research_json" jsonb;--> statement-breakpoint
ALTER TABLE "account_person" ADD COLUMN "researched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_person" ADD COLUMN "researched_by" text;
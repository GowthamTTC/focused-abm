ALTER TABLE "org" ALTER COLUMN "settings_json" SET DEFAULT '{"enrichLimit":10,"classifyLlmPeopleCap":1000}'::jsonb;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "outreach_status" text;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "flag_verdict" text;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "last_post_at" timestamp with time zone;
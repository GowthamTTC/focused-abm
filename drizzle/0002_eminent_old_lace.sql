ALTER TABLE "org" ALTER COLUMN "settings_json" SET DEFAULT '{"enrichLimit":10,"classifyLlmPeopleCap":1000,"catalogMode":"managed"}'::jsonb;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "member_id" text;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "connection" ADD COLUMN "last_scan_at" timestamp with time zone;
ALTER TABLE "app_user" ADD COLUMN "onboarding_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "app_user" SET "onboarding_step" = 8, "onboarding_completed_at" = now() WHERE "onboarding_completed_at" IS NULL;

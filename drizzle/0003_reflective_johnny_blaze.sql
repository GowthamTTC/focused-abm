CREATE TABLE "export_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"batch_id" text,
	"label" text NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"day" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"pitchable" integer DEFAULT 0 NOT NULL,
	"enriched" integer DEFAULT 0 NOT NULL,
	"active30" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_log" ADD CONSTRAINT "export_log_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_snapshot" ADD CONSTRAINT "network_snapshot_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;
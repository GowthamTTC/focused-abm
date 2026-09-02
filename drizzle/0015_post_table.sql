CREATE TABLE "post" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"text" text NOT NULL,
	"url" text,
	"posted_at" timestamp with time zone,
	"relevance" integer,
	"category" text,
	"hook" text,
	"judged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_connection_provider_uq" ON "post" USING btree ("connection_id","provider_id");--> statement-breakpoint
CREATE INDEX "post_org_posted_idx" ON "post" USING btree ("org_id","posted_at");--> statement-breakpoint
CREATE INDEX "post_org_relevance_idx" ON "post" USING btree ("org_id","relevance","posted_at");
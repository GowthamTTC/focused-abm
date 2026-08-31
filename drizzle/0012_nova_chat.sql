CREATE TABLE IF NOT EXISTS "nova_chat" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "app_user"("id"),
  "org_id" text NOT NULL REFERENCES "org"("id"),
  "title" text NOT NULL DEFAULT 'New chat',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "nova_chat_user_idx" ON "nova_chat" ("user_id", "updated_at");
CREATE TABLE IF NOT EXISTS "nova_chat_message" (
  "id" text PRIMARY KEY,
  "chat_id" text NOT NULL REFERENCES "nova_chat"("id"),
  "role" text NOT NULL,
  "content" text NOT NULL,
  "suggestions_json" jsonb,
  "pending_json" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "nova_chat_msg_idx" ON "nova_chat_message" ("chat_id", "created_at");

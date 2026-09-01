import { and, desc, eq } from "drizzle-orm";
import { db, novaChat, novaChatMessage } from "@/db";

const MSG_COLS = {
  id: novaChatMessage.id,
  chatId: novaChatMessage.chatId,
  role: novaChatMessage.role,
  content: novaChatMessage.content,
  suggestionsJson: novaChatMessage.suggestionsJson,
  pendingJson: novaChatMessage.pendingJson,
  createdAt: novaChatMessage.createdAt,
};

export async function listChats(userId: string) {
  return db.select({
    id: novaChat.id,
    title: novaChat.title,
    updatedAt: novaChat.updatedAt,
  }).from(novaChat).where(eq(novaChat.userId, userId)).orderBy(desc(novaChat.updatedAt)).limit(40);
}

export async function createChat(userId: string, orgId: string, title = "New chat") {
  const [row] = await db.insert(novaChat).values({ userId, orgId, title }).returning();
  return row!;
}

export async function loadChat(userId: string, chatId: string) {
  const [chat] = await db.select().from(novaChat).where(and(eq(novaChat.id, chatId), eq(novaChat.userId, userId))).limit(1);
  if (!chat) return null;
  const messages = await db.select(MSG_COLS).from(novaChatMessage)
    .where(eq(novaChatMessage.chatId, chatId)).orderBy(novaChatMessage.createdAt);
  return { chat, messages: messages.map((m) => ({ ...m, cardsJson: [] as { kind: string; title: string; subtitle?: string; pills: string[] }[] })) };
}

export async function appendTurn(input: {
  userId: string;
  orgId: string;
  chatId?: string;
  userText: string;
  assistantText: string;
  suggestions?: string[];
  pending?: { kind: string; title: string; yes: string; tone?: string }[];
  cards?: { kind: string; title: string; subtitle?: string; pills: string[] }[];
}) {
  let chatId = input.chatId;
  if (!chatId) {
    const chat = await createChat(input.userId, input.orgId, input.userText.slice(0, 48) || "New chat");
    chatId = chat.id;
  } else {
    const [own] = await db.select({ id: novaChat.id }).from(novaChat)
      .where(and(eq(novaChat.id, chatId), eq(novaChat.userId, input.userId))).limit(1);
    if (!own) {
      const chat = await createChat(input.userId, input.orgId, input.userText.slice(0, 48));
      chatId = chat.id;
    } else {
      const [existing] = await db.select({ id: novaChatMessage.id }).from(novaChatMessage)
        .where(eq(novaChatMessage.chatId, chatId)).limit(1);
      await db.update(novaChat).set({
        ...(existing ? {} : { title: input.userText.slice(0, 48) }),
        updatedAt: new Date(),
      }).where(eq(novaChat.id, chatId));
    }
  }
  const baseUser = { chatId, role: "user" as const, content: input.userText };
  const baseAsst = {
    chatId,
    role: "assistant" as const,
    content: input.assistantText,
    suggestionsJson: input.suggestions ?? [],
    pendingJson: input.pending ?? [],
  };
  try {
    await db.insert(novaChatMessage).values([
      baseUser,
      { ...baseAsst, cardsJson: input.cards ?? [] },
    ]);
  } catch {
    await db.insert(novaChatMessage).values([baseUser, baseAsst]);
  }
  return chatId;
}

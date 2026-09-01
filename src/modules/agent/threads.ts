import { and, desc, eq } from "drizzle-orm";
import { db, novaChat, novaChatMessage } from "@/db";

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
  const messages = await db.select().from(novaChatMessage)
    .where(eq(novaChatMessage.chatId, chatId)).orderBy(novaChatMessage.createdAt);
  return { chat, messages };
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
    const title = input.userText.slice(0, 48) || "New chat";
    const chat = await createChat(input.userId, input.orgId, title);
    chatId = chat.id;
  } else {
    const [own] = await db.select({ id: novaChat.id }).from(novaChat)
      .where(and(eq(novaChat.id, chatId), eq(novaChat.userId, input.userId))).limit(1);
    if (!own) {
      const chat = await createChat(input.userId, input.orgId, input.userText.slice(0, 48));
      chatId = chat.id;
    } else {
      const [count] = await db.select().from(novaChatMessage).where(eq(novaChatMessage.chatId, chatId)).limit(3);
      if (!count) {
        await db.update(novaChat).set({ title: input.userText.slice(0, 48), updatedAt: new Date() }).where(eq(novaChat.id, chatId));
      } else {
        await db.update(novaChat).set({ updatedAt: new Date() }).where(eq(novaChat.id, chatId));
      }
    }
  }
  await db.insert(novaChatMessage).values([
    { chatId, role: "user", content: input.userText },
    {
      chatId, role: "assistant", content: input.assistantText,
      suggestionsJson: input.suggestions ?? [],
      pendingJson: input.pending ?? [],
      cardsJson: input.cards ?? [],
    },
  ]);
  return chatId;
}

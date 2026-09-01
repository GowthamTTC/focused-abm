import { NextResponse } from "next/server";
import { currentUser } from "@/auth/session";
import { loadChat, deleteChat } from "@/modules/agent/threads";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await params;
  const row = await loadChat(user.userId, id);
  if (!row) return NextResponse.json({ error: "missing" }, { status: 404 });
  return NextResponse.json({
    chat: row.chat,
    messages: row.messages.map((m) => ({
      role: m.role,
      content: m.content,
      suggestions: m.suggestionsJson ?? [],
      pending: m.pendingJson ?? [],
      cards: m.cardsJson ?? [],
    })),
  });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteChat(user.userId, id);
  if (!ok) return NextResponse.json({ error: "missing" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

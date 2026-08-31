import { NextResponse } from "next/server";
import { currentUser } from "@/auth/session";
import { createChat, listChats } from "@/modules/agent/threads";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const chats = await listChats(user.userId);
  return NextResponse.json({ chats });
}

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const chat = await createChat(user.userId, user.orgId);
  return NextResponse.json({ chat });
}

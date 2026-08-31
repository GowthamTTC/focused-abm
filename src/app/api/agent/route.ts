import { NextResponse } from "next/server";
import { currentUser } from "@/auth/session";
import { runAgent } from "@/modules/agent/run";
import { absorb, loadLearn, saveLearn } from "@/modules/agent/learn";
import { rateLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client-ip";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const ip = clientIp(req);
  const rl = rateLimit(`agent:${user.userId}:${ip}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate" }, { status: 429 });

  const body = await req.json().catch(() => null) as {
    message?: string;
    page?: string;
    history?: { role: "user" | "assistant"; content: string }[];
  } | null;
  const message = (body?.message ?? "").trim();
  if (!message || message.length > 2000) {
    return NextResponse.json({ error: "message" }, { status: 400 });
  }
  const page = (body?.page ?? "app").slice(0, 40);
  const history = Array.isArray(body?.history) ? body!.history.slice(-8) : [];

  const prev = await loadLearn(user.userId);
  const learn = absorb(prev, message);
  await saveLearn(user.userId, learn);

  try {
    const t0 = Date.now();
    const out = await runAgent({
      orgId: user.orgId,
      page,
      message,
      history,
      learn,
    });
    return NextResponse.json({ ...out, tookMs: Date.now() - t0, habits: learn.topics });
  } catch (e) {
    const err = e instanceof Error ? e.message : "failed";
    return NextResponse.json({ reply: `Could not finish that: ${err.slice(0, 180)}` }, { status: 200 });
  }
}

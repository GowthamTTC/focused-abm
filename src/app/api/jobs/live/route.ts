/**
 * Server-Sent Events stream of the latest job for this org.
 * Pushes ~1/s. Auth via session cookie (EventSource cannot set headers).
 */
import { desc, eq } from "drizzle-orm";
import { db, job } from "@/db";
import { currentUser } from "@/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response("auth", { status: 401 });

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const push = async () => {
        try {
          const [latest] = await db.select({
            id: job.id, kind: job.kind, status: job.status,
            progress: job.progress, total: job.total, payloadJson: job.payloadJson,
          }).from(job).where(eq(job.orgId, user.orgId)).orderBy(desc(job.createdAt)).limit(1);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ job: latest ? { id: latest.id, kind: latest.kind, status: latest.status, progress: latest.progress, total: latest.total, current: typeof latest.payloadJson?.current === 'string' ? latest.payloadJson.current : null } : null })}\n\n`));
        } catch {
          try { controller.enqueue(encoder.encode(`data: {"job":null}\n\n`)); } catch { /* closed */ }
        }
      };
      void push();
      timer = setInterval(() => { void push(); }, 1000);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

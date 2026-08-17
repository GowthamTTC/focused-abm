"use client";
/** Network-resilience boundary. On some connections, security software
 *  corrupts the streamed response to an action even though the server
 *  completed the work. When that specific failure hits, we do what a human
 *  would: reload once — the fresh page shows the action's true result.
 *  A timestamp guard prevents reload loops. */
import { useEffect, useState } from "react";

const RECOVERABLE = /unexpected response|failed to fetch|chunkloaderror|loading chunk|network ?error/i;
const KEY = "fabm-recovered-at";

export default function AppError({ error, reset }: {
  error: Error & { digest?: string }; reset: () => void;
}) {
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    if (!RECOVERABLE.test(error.message ?? "")) return;
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 8000) return; // recovered seconds ago — show fallback instead of looping
    sessionStorage.setItem(KEY, String(Date.now()));
    setRecovering(true);
    window.location.reload();
  }, [error]);

  if (recovering) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F6F7FB]">
        <p className="text-sm text-[#475467]">One moment — refreshing the view…</p>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F6F7FB] px-4">
      <div className="w-full max-w-md rounded-[14px] border border-[#DDE2EE] bg-white p-8 text-center shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <h1 className="text-lg font-semibold text-[#101828]">The view hiccupped</h1>
        <p className="mt-2 text-sm text-[#475467]">
          Your last action most likely still went through — this screen is about displaying
          the result, not doing the work.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button onClick={() => window.location.reload()}
            className="rounded-[10px] bg-[#263BAA] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
            Reload
          </button>
          <button onClick={reset}
            className="rounded-[10px] border border-[#DDE2EE] px-4 py-2.5 text-sm text-[#475467] hover:bg-[#F4F6FB]">
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}

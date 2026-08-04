"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Polls router.refresh() while a job is running — dependency-free progress. */
export function AutoRefresh({ everyMs = 2500 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}

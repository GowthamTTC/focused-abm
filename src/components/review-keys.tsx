"use client";
/** Keyboard layer for Review: J/K move through ?p=, C copies, E opens record. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function ReviewKeys({ ids, current, base, copyText, recordHref }: {
  ids: string[]; current: string | null; base: string; copyText?: string; recordHref?: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = current ? ids.indexOf(current) : -1;
      if (e.key === "j" || e.key === "J") {
        const next = ids[Math.min(idx + 1, ids.length - 1)];
        if (next) router.push(`${base}&p=${next}`);
      } else if (e.key === "k" || e.key === "K") {
        const prev = ids[Math.max(idx - 1, 0)];
        if (prev) router.push(`${base}&p=${prev}`);
      } else if ((e.key === "c" || e.key === "C") && copyText) {
        navigator.clipboard?.writeText(copyText);
      } else if ((e.key === "e" || e.key === "E") && recordHref) {
        router.push(recordHref);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, current, base, copyText, recordHref, router]);
  return null;
}

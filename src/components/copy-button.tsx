"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Copy message" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-lg border border-[#263BAA]/20 bg-[#263BAA]/10 px-3 py-1.5 text-sm text-[#E8EAF0] hover:bg-white/15">
      {copied ? "Copied ✓" : label}
    </button>
  );
}

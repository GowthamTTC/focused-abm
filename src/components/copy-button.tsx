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
      className="rounded-lg border border-[#263BAA]/20 bg-[#263BAA]/10 px-3 py-1.5 text-sm text-[#1B2559] hover:bg-[#263BAA]/15">
      {copied ? "Copied ✓" : label}
    </button>
  );
}

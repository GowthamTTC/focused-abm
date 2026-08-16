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
      className="rounded-[8px] border border-[#DDE2EE] bg-[#EEF1FC] px-3 py-1.5 text-sm text-[#101828] hover:bg-[#EEF1FC]">
      {copied ? "Copied ✓" : label}
    </button>
  );
}

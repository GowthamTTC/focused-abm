"use client";

import { useEffect, useState } from "react";
import { NovaThread } from "@/components/agent-rail";

type Chat = { id: string; title: string; updatedAt: string };

export function NovaDesk({ page }: { page: string }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [active, setActive] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/agent/chats", { cache: "no-store" });
    const data = await res.json().catch(() => null) as { chats?: Chat[] } | null;
    setChats(data?.chats ?? []);
  }

  useEffect(() => { void refresh(); }, []);

  async function remove(id: string) {
    const res = await fetch(`/api/agent/chats/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setChats((c) => c.filter((x) => x.id !== id));
    setActive((cur) => (cur === id ? null : cur));
  }

  async function fresh() {
    const res = await fetch("/api/agent/chats", { method: "POST" });
    const data = await res.json().catch(() => null) as { chat?: Chat } | null;
    if (data?.chat) {
      setActive(data.chat.id);
      setChats((c) => [data.chat!, ...c.filter((x) => x.id !== data.chat!.id)]);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-140px)] gap-6">
      <aside className="hidden w-52 shrink-0 md:block">
        <button
          type="button"
          onClick={() => void fresh()}
          className="btn-press mb-3 w-full rounded-[8px] bg-[#263BAA] px-3 py-2 text-[12.5px] font-medium text-white"
        >
          New chat
        </button>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-[#98A2B3]">History</p>
        <div className="space-y-0.5">
          {chats.length === 0 && <p className="text-[12px] text-[#98A2B3]">No chats yet.</p>}
          {chats.map((c) => (
            <div key={c.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActive(c.id)}
                className={`min-w-0 flex-1 truncate rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] ${
                  active === c.id ? "bg-[#EEF1FC] font-medium text-[#263BAA]" : "text-[#475467] hover:bg-[#F4F6FB]"
                }`}
              >
                {c.title || "New chat"}
              </button>
              <button
                type="button"
                title="Delete chat"
                onClick={() => void remove(c.id)}
                className="shrink-0 rounded px-1.5 py-1 text-[11px] text-[#98A2B3] hover:bg-[#FEF3F2] hover:text-[#B42318]"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center justify-between md:hidden">
          <button type="button" onClick={() => void fresh()} className="text-[12.5px] text-[#263BAA]">New chat</button>
        </div>
        <NovaThread
          page={page}
          chatId={active}
          onChatId={(id) => { setActive(id); void refresh(); }}
        />
      </div>
    </div>
  );
}

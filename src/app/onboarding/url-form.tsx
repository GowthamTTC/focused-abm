"use client";
import { useFormStatus } from "react-dom";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <>
      <button disabled={pending}
        className="shrink-0 rounded-[10px] bg-[#263BAA] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86] disabled:opacity-50">
        {pending ? "Reading your site…" : "Read my site"}
      </button>
      {pending && (
        <p className="basis-full text-xs text-[#98A2B3]">
          Fetching your pages and drafting the offers — this takes up to a minute. Leave this tab open.
        </p>
      )}
    </>
  );
}

export function UrlForm({ action, defaultValue }: {
  action: (fd: FormData) => Promise<void>;
  defaultValue?: string;
}) {
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input name="url" type="text" required autoComplete="url" defaultValue={defaultValue}
        placeholder="yourcompany.com"
        className="min-w-0 flex-1 rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-2.5 text-sm shadow-[0_1px_2px_rgba(16,24,40,.04)]" />
      <Submit />
    </form>
  );
}

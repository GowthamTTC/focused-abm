import { redirect } from "next/navigation";
import { currentUser } from "@/auth/session";

export default async function ChangePasswordPage(props: {
  searchParams: Promise<{ err?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { err } = await props.searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F6F7FB] px-4">
      <div className="w-full max-w-md rounded-[14px] border border-[#DDE2EE] bg-white p-8 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <h1 className="text-xl font-semibold text-[#101828]">Set your own password</h1>
        <p className="mt-2 text-sm text-[#475467]">
          You signed in with a temporary password issued by your admin. Choose your own before
          continuing — only you will know it.
        </p>
        {err === "short" && <p className="mt-3 text-sm text-[#B42318]">At least 8 characters, please.</p>}
        {err === "match" && <p className="mt-3 text-sm text-[#B42318]">The two entries don't match.</p>}
        <form method="post" action="/api/change-password" className="mt-5 space-y-4">
          <label className="block text-sm text-[#475467]">New password
            <input name="password" type="password" autoComplete="new-password" required minLength={8}
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-3 text-sm" />
          </label>
          <label className="block text-sm text-[#475467]">Repeat it
            <input name="confirm" type="password" autoComplete="new-password" required minLength={8}
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-3 text-sm" />
          </label>
          <button className="w-full rounded-[10px] bg-[#263BAA] py-3 text-sm font-semibold text-white hover:bg-[#1D2E86]">
            Save and continue
          </button>
        </form>
      </div>
    </main>
  );
}

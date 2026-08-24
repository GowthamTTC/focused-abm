import Link from "next/link";
import { currentUser } from "@/auth/session";

export default async function ChangePasswordPage(props: {
  searchParams: Promise<{ err?: string }>;
}) {
  const user = await currentUser();
  const { err } = await props.searchParams;
  const forced = Boolean(user?.mustChangePassword);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F6F7FB] px-4">
      <div className="w-full max-w-md rounded-[14px] border border-[#DDE2EE] bg-white p-8 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <h1 className="text-xl font-semibold text-[#101828]">
          {forced ? "Set your own password" : "Change your password"}
        </h1>
        <p className="mt-2 text-sm text-[#475467]">
          {forced
            ? "You signed in with a temporary password issued by your admin. Choose your own before continuing — only you will know it."
            : user
              ? "Pick a new password for your account."
              : "Enter your email and current password, then choose a new one."}
        </p>

        {err === "short" && <p className="mt-3 text-sm text-[#B42318]">At least 8 characters, please.</p>}
        {err === "match" && <p className="mt-3 text-sm text-[#B42318]">The two entries don&apos;t match.</p>}
        {err === "creds" && <p className="mt-3 text-sm text-[#B42318]">That email and current password don&apos;t match an account.</p>}

        <form method="post" action="/api/change-password" className="mt-5 space-y-4">
          {!user && (
            <>
              <label className="block text-sm text-[#475467]">Email
                <input name="email" type="email" autoComplete="email" required
                  className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-3 text-sm" />
              </label>
              <label className="block text-sm text-[#475467]">Current password
                <input name="current" type="password" autoComplete="current-password" required
                  className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-3 text-sm" />
              </label>
            </>
          )}
          <label className="block text-sm text-[#475467]">New password
            <input name="password" type="password" autoComplete="new-password" required minLength={12}
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-3 text-sm" />
          </label>
          <label className="block text-sm text-[#475467]">Repeat it
            <input name="confirm" type="password" autoComplete="new-password" required minLength={12}
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-4 py-3 text-sm" />
          </label>
          <button className="w-full rounded-[10px] bg-[#263BAA] py-3 text-sm font-semibold text-white hover:bg-[#1D2E86]">
            {forced ? "Save and continue" : "Save new password"}
          </button>
        </form>

        {!forced && (
          <Link href={user ? "/dashboard" : "/login"}
            className="mt-4 block text-center text-sm text-[#475467] underline decoration-[#DDE2EE] hover:text-[#101828]">
            {user ? "Back to the app" : "Back to sign in"}
          </Link>
        )}
        {!user && (
          <p className="mt-4 text-xs text-[#98A2B3]">
            Forgotten it entirely? Your admin can issue a fresh temporary password from the Console.
          </p>
        )}
      </div>
    </main>
  );
}

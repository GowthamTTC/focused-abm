
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string; changed?: string }> }) {
  const { err, changed } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-6"
      style={{ backgroundImage: "radial-gradient(700px 340px at 28% 0%, rgba(38,59,170,.06), transparent)" }}>
      <form method="post" action="/api/login"
        className="w-full max-w-md bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-8">
        <h1 className="text-[26px] font-semibold text-[#263BAA]">Focused ABM</h1>
        <p className="mt-1.5 text-sm text-[#98A2B3]">Connections → ranked batches → workbook.</p>
        {err === "rate" && <p className="mt-5 text-sm text-[#B42318]">Too many sign-in attempts. Try again in 15 minutes.</p>}
        {err && err !== "rate" && <p className="mt-5 text-sm text-[#B42318]">Wrong email or password.</p>}
        {changed && <p className="mt-5 text-sm text-[#067647]">Password updated — sign in with it.</p>}
        <label className="mt-5 block text-sm text-[#475467]">Email
          <input name="email" autoComplete="email" type="email" required placeholder="you@tossthe.co.in"
            className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm text-[#101828]" />
        </label>
        <label className="mt-4 block text-sm text-[#475467]">Password
          <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••"
            className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm" />
        </label>
        <button className="mt-6 w-full rounded-[10px] bg-[#263BAA] py-3 text-sm font-semibold text-white hover:bg-[#1D2E86]">
          Sign in
        </button>
        <a href="/signup"
          className="mt-4 block text-center text-sm text-[#475467] underline decoration-[#DDE2EE] hover:text-[#101828]">
          Create a workspace
        </a>
        <a href="/change-password"
          className="mt-2 block text-center text-sm text-[#475467] underline decoration-[#DDE2EE] hover:text-[#101828]">
          Change password
        </a>
      </form>
    </main>
  );
}

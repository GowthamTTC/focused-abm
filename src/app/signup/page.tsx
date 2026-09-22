const ERRORS: Record<string, string> = {
  rate: "Too many sign-up attempts. Try again in 15 minutes.",
  email: "Enter a valid email address.",
  org: "Enter your company or team name.",
  taken: "That email already has a login — sign in instead.",
  closed: "Self-serve signup isn't open for that email yet — ask an admin to create your account.",
  match: "The two passwords don't match.",
  policy: "At least 12 characters, using 3 of: lowercase, uppercase, number, symbol.",
};

export default async function SignupPage({ searchParams }: {
  searchParams: Promise<{ err?: string; email?: string; org?: string; name?: string }>;
}) {
  const { err, email, org, name } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-6"
      style={{ backgroundImage: "radial-gradient(700px 340px at 28% 0%, rgba(38,59,170,.06), transparent)" }}>
      <form method="post" action="/api/signup"
        className="w-full max-w-md bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-8">
        <h1 className="text-[26px] font-semibold text-[#263BAA]">Create your workspace</h1>
        <p className="mt-1.5 text-sm text-[#98A2B3]">Eight guided steps from zero to a ranked pipeline.</p>
        {err && <p className="mt-5 text-sm text-[#B42318]">{ERRORS[err] ?? "Something went wrong. Try again."}</p>}
        <label className="mt-5 block text-sm text-[#475467]">Company or team
          <input name="orgName" required maxLength={120} defaultValue={org ?? ""} placeholder="Toss the Coin"
            className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm text-[#101828]" />
        </label>
        <label className="mt-4 block text-sm text-[#475467]">Your name
          <input name="name" maxLength={120} defaultValue={name ?? ""} autoComplete="name" placeholder="Optional"
            className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm text-[#101828]" />
        </label>
        <label className="mt-4 block text-sm text-[#475467]">Email
          <input name="email" autoComplete="email" type="email" required maxLength={254} defaultValue={email ?? ""}
            placeholder="you@tossthe.co.in"
            className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm text-[#101828]" />
        </label>
        <label className="mt-4 block text-sm text-[#475467]">Password
          <input name="password" type="password" autoComplete="new-password" required minLength={12} placeholder="••••••••••••"
            className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm" />
        </label>
        <label className="mt-4 block text-sm text-[#475467]">Repeat it
          <input name="confirm" type="password" autoComplete="new-password" required minLength={12} placeholder="••••••••••••"
            className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm" />
        </label>
        <p className="mt-3 text-xs text-[#98A2B3]">
          At least 12 characters, using 3 of: lowercase, uppercase, number, symbol.
        </p>
        <button className="mt-6 w-full rounded-[10px] bg-[#263BAA] py-3 text-sm font-semibold text-white hover:bg-[#1D2E86]">
          Create workspace
        </button>
        <a href="/login"
          className="mt-4 block text-center text-sm text-[#475467] underline decoration-[#DDE2EE] hover:text-[#101828]">
          Already have a login? Sign in
        </a>
      </form>
    </main>
  );
}

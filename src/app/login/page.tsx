import { redirect } from "next/navigation";
import { login } from "@/auth/session";

async function doLogin(formData: FormData) {
  "use server";
  const ok = await login(String(formData.get("email")), String(formData.get("password")));
  redirect(ok ? "/connections" : "/login?err=1");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-6"
      style={{ backgroundImage: "radial-gradient(700px 340px at 28% 0%, rgba(38,59,170,.06), transparent)" }}>
      <form action={doLogin}
        className="w-full max-w-md bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-8">
        <h1 className="text-[26px] font-semibold text-[#263BAA]">Focused ABM</h1>
        <p className="mt-1.5 text-sm text-[#98A2B3]">Connections → ranked batches → workbook.</p>
        {err && <p className="mt-5 text-sm text-[#B42318]">Wrong email or password.</p>}
        <label className="mt-5 block text-sm text-[#475467]">Email
          <input name="email" type="email" required placeholder="you@tossthe.co.in"
            className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm text-[#101828]" />
        </label>
        <label className="mt-4 block text-sm text-[#475467]">Password
          <input name="password" type="password" required placeholder="••••••••"
            className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm" />
        </label>
        <button className="mt-6 w-full rounded-[10px] bg-[#263BAA] py-3 text-sm font-semibold text-white hover:bg-[#1D2E86]">
          Sign in
        </button>
      </form>
    </main>
  );
}

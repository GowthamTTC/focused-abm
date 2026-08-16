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
        className="w-full max-w-md rounded-[18px] border border-[#E4E7F2] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] p-8">
        <h1 className="text-3xl font-semibold text-[#263BAA]">Focused ABM</h1>
        <p className="mt-1.5 text-sm text-[#46506E]/55">Connections → ranked batches → workbook.</p>
        {err && <p className="mt-5 text-sm text-[#B42318]">Wrong email or password.</p>}
        <label className="mt-5 block text-sm text-[#46506E]/70">Email
          <input name="email" type="email" required placeholder="you@tossthe.co.in"
            className="mt-1.5 w-full rounded-xl border border-[#E4E7F2] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm text-[#14204A]" />
        </label>
        <label className="mt-4 block text-sm text-[#46506E]/70">Password
          <input name="password" type="password" required placeholder="••••••••"
            className="mt-1.5 w-full rounded-xl border border-[#E4E7F2] bg-white shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3 text-sm" />
        </label>
        <button className="mt-6 w-full rounded-xl bg-[#263BAA] py-3 text-sm font-semibold text-[#14204A] shadow-[0_0_24px_rgba(38,59,170,.3)] hover:bg-[#1D2E86]">
          Sign in
        </button>
      </form>
    </main>
  );
}

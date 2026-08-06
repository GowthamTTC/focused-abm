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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Focused ABM</h1>
        <p className="mt-1 text-sm text-[#16191E]/55">Connections → ranked batches → workbook.</p>
      </div>
      <form action={doLogin} className="flex flex-col gap-3 rounded-[18px] border border-white/10 bg-[#1F2329] p-5 shadow-sm">
        {err && <p className="text-sm text-red-400">Wrong email or password.</p>}
        <label className="text-sm font-medium">Email
          <input name="email" type="email" required className="mt-1 w-full rounded border border-white/15 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium">Password
          <input name="password" type="password" required className="mt-1 w-full rounded border border-white/15 px-3 py-2 text-sm" />
        </label>
        <button className="mt-2 rounded bg-[#B6FF2E] px-3 py-2 text-sm font-medium text-[#16191E] hover:bg-[#9FE51F]">Sign in</button>
      </form>
    </main>
  );
}

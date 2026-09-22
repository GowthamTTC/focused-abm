import { redirect } from "next/navigation";
import { logout } from "@/auth/session";
import { requireSetupUser } from "./guard";

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSetupUser();
  return (
    <main className="min-h-screen px-6 py-10"
      style={{ backgroundImage: "radial-gradient(700px 340px at 28% 0%, rgba(38,59,170,.06), transparent)" }}>
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold text-[#263BAA]">Set up Focused ABM</h1>
            <p className="mt-1.5 text-sm text-[#98A2B3]">Signed in as {user.email}</p>
          </div>
          <form action={signOut}>
            <button className="text-sm text-[#475467] underline decoration-[#DDE2EE] hover:text-[#101828]">
              Sign out
            </button>
          </form>
        </header>
        <div className="mt-6 rounded-[14px] border border-[#DDE2EE] bg-white p-8 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          {children}
        </div>
      </div>
    </main>
  );
}

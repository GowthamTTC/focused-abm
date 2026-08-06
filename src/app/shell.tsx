import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, logout, type Ctx } from "@/auth/session";

async function doLogout() { "use server"; await logout(); redirect("/login"); }

export async function requirePage(): Promise<Ctx> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export function Shell({ user, active, children }: { user: Ctx; active: string; children: React.ReactNode }) {
  const tabs = [
    ["connections", "Connections"],
    ["services", "Services"],
    ["settings", "Settings"],
  ] as const;
  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 bg-[#1F2329]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <span className="text-sm font-semibold tracking-tight">Focused ABM</span>
            <nav className="flex gap-4 text-sm">
              {tabs.map(([slug, label]) => (
                <Link key={slug} href={`/${slug}`}
                  className={active === slug ? "font-medium text-[#E8EAF0]" : "text-white/55 hover:text-[#E8EAF0]"}>
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <form action={doLogout}>
            <button className="text-xs text-white/55 hover:text-[#E8EAF0]">{user.email} · sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

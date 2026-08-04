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
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <span className="text-sm font-semibold tracking-tight">Focused ABM</span>
            <nav className="flex gap-4 text-sm">
              {tabs.map(([slug, label]) => (
                <Link key={slug} href={`/${slug}`}
                  className={active === slug ? "font-medium text-neutral-900" : "text-neutral-500 hover:text-neutral-900"}>
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <form action={doLogout}>
            <button className="text-xs text-neutral-500 hover:text-neutral-900">{user.email} · sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

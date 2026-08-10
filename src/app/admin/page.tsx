import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, appUser, org } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { env } from "@/lib/env";
import { addUser, removeUser } from "./actions";

export default async function AdminPage({ searchParams }: {
  searchParams: Promise<{ err?: string; ok?: string }>;
}) {
  const user = await requirePage();
  if (user.email.toLowerCase() !== (env.ADMIN_EMAIL ?? "").toLowerCase()) notFound();
  const { err, ok } = await searchParams;
  const users = await db.select({
    id: appUser.id, name: appUser.name, email: appUser.email,
    createdAt: appUser.createdAt, workspace: org.name,
  }).from(appUser).leftJoin(org, eq(appUser.orgId, org.id)).orderBy(appUser.createdAt);

  return (
    <Shell user={user} active="admin">
      <h1 className="text-2xl font-semibold">Admin console</h1>
      <p className="mt-1 text-sm text-white/55">
        Every user gets their own isolated workspace — their own batches, services, seat, and
        settings. Nobody sees anyone else's data.
      </p>

      <section className="mt-6 rounded-[18px] border border-white/10 bg-[#1F2329] p-6">
        <h2 className="text-lg font-medium">Add a user</h2>
        {err && <p className="mt-2 text-sm text-[#FF8A70]">{err}</p>}
        {ok && <p className="mt-2 text-sm text-[#B6FF2E]">User added with a fresh workspace (six services pre-seeded) — share the credentials with them directly.</p>}
        <form action={addUser} className="mt-4 grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block text-sm text-white/70">Name
            <input name="name" required placeholder="Priya S"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm text-white/70">Email
            <input name="email" type="email" required placeholder="priya@tossthe.co.in"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm text-white/70">Password
            <input name="password" type="text" required minLength={8} placeholder="min 8 characters"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm" />
          </label>
          <div>
            <button className="rounded-lg bg-[#B6FF2E] px-4 py-2.5 text-sm font-semibold text-[#16191E] hover:bg-[#9FE51F]">
              Add user
            </button>
          </div>
        </form>
      </section>

      <section className="mt-6 rounded-[18px] border border-white/10 bg-[#1F2329] p-6">
        <h2 className="text-lg font-medium">Users <span className="tnum ml-1 text-white/40">{users.length}</span></h2>
        <ul className="mt-3 divide-y divide-white/5">
          {users.map((u) => {
            const isAdmin = u.email === (env.ADMIN_EMAIL ?? "").toLowerCase();
            return (
              <li key={u.id} className="flex items-center gap-4 py-3 text-sm">
                <span className="w-40 truncate font-medium">{u.name}</span>
                <span className="tnum min-w-0 flex-1 truncate text-white/60">{u.email}</span>
                <span className="hidden max-w-48 truncate text-xs text-white/35 md:inline">{u.workspace}</span>
                {isAdmin && <span className="rounded bg-[#B6FF2E]/15 px-1.5 py-0.5 text-[11px] text-[#B6FF2E]">admin</span>}
                <span className="tnum text-xs text-white/30">since {u.createdAt.toISOString().slice(0, 10)}</span>
                {!isAdmin && (
                  <form action={removeUser.bind(null, u.id)}>
                    <button className="text-xs text-red-400 hover:text-red-300">Remove</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </Shell>
  );
}

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, appUser, org } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { env } from "@/lib/env";
import { addUser, removeUser, syncCatalogToAllWorkspaces } from "./actions";

export default async function AdminPage({ searchParams }: {
  searchParams: Promise<{ err?: string; ok?: string; n?: string; skipped?: string }>;
}) {
  const user = await requirePage();
  if (user.email.toLowerCase() !== (env.ADMIN_EMAIL ?? "").toLowerCase()) notFound();
  const { err, ok, n, skipped } = await searchParams;
  const users = await db.select({
    id: appUser.id, name: appUser.name, email: appUser.email,
    createdAt: appUser.createdAt, workspace: org.name,
  }).from(appUser).leftJoin(org, eq(appUser.orgId, org.id)).orderBy(appUser.createdAt);

  return (
    <Shell user={user} active="admin">
      <h1 className="text-2xl font-semibold">Admin console</h1>
      <p className="mt-1 text-sm text-[#98A2B3]">
        Every user gets their own isolated workspace — their own batches, services, seat, and
        settings. Nobody sees anyone else's data.
      </p>

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <h2 className="text-lg font-medium">Add a user</h2>
        {err && <p className="mt-2 text-sm text-[#B42318]">{err}</p>}
        {ok === "1" && <p className="mt-2 text-sm text-[#263BAA]">User added with a fresh workspace (catalog pre-seeded) — share the credentials with them directly.</p>}
        <form action={addUser} className="mt-4 grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block text-sm text-[#475467]">Name
            <input name="name" required placeholder="Priya S"
              className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm text-[#475467]">Email
            <input name="email" type="email" required placeholder="priya@tossthe.co.in"
              className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm text-[#475467]">Password
            <input name="password" type="text" required minLength={8} placeholder="min 8 characters"
              className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm text-[#475467] md:col-span-2">Offers in their workspace
            <select name="catalogMode"
              className="mt-1.5 w-full bg-white border border-[#DDE2EE] rounded-[10px] shadow-[0_1px_2px_rgba(16,24,40,.04)] px-3 py-2.5 text-sm">
              <option value="managed">TTC catalogue — seed our seven services (internal seat)</option>
              <option value="own">Their own offers — start empty, they define their services (external client)</option>
            </select>
            <span className="mt-1 block text-xs text-[#98A2B3]">
              Client workspaces are never overwritten by &ldquo;Sync catalogue&rdquo;.
            </span>
          </label>
          <div>
            <button className="rounded-[8px] bg-[#263BAA] px-4 py-2.5 text-sm font-semibold text-[#101828] hover:bg-[#1D2E86]">
              Add user
            </button>
          </div>
        </form>
      </section>

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">Catalog</h2>
            <p className="mt-1 max-w-xl text-sm text-[#98A2B3]">
              Push your workspace&rsquo;s current services (names + ICPs) to every TTC-managed workspace,
              replacing theirs. Client workspaces that define their own offers are skipped.
            </p>
            {ok === "synced" && <p className="mt-2 text-sm text-[#263BAA]">Catalogue synced to {n} workspace(s).{Number(skipped) > 0 && ` ${skipped} client workspace(s) skipped — they own their offers.`}</p>}
          </div>
          <form action={syncCatalogToAllWorkspaces}>
            <button className="rounded-[8px] border border-[#263BAA]/40 bg-[#EEF1FC] px-4 py-2 text-sm font-medium text-[#263BAA] hover:bg-[#EEF1FC]">
              Sync catalog to all workspaces
            </button>
          </form>
        </div>
      </section>

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <h2 className="text-lg font-medium">Users <span className="tnum ml-1 text-[#98A2B3]">{users.length}</span></h2>
        <ul className="mt-3 divide-y divide-[#EEF1F8]">
          {users.map((u) => {
            const isAdmin = u.email === (env.ADMIN_EMAIL ?? "").toLowerCase();
            return (
              <li key={u.id} className="flex items-center gap-4 py-3 text-sm">
                <span className="w-40 truncate font-medium">{u.name}</span>
                <span className="tnum min-w-0 flex-1 truncate text-[#475467]">{u.email}</span>
                <span className="hidden max-w-48 truncate text-xs text-[#98A2B3] md:inline">{u.workspace}</span>
                {isAdmin && <span className="rounded bg-[#EEF1FC] px-1.5 py-0.5 text-[11px] text-[#263BAA]">admin</span>}
                <span className="tnum text-xs text-[#98A2B3]">since {u.createdAt.toISOString().slice(0, 10)}</span>
                {!isAdmin && (
                  <form action={removeUser.bind(null, u.id)}>
                    <button className="text-xs text-[#B42318] hover:text-[#B42318]">Remove</button>
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

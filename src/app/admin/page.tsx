import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db, appUser, org, clientAccount } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { env } from "@/lib/env";
import { assignUserToAccount, createClientAccount, removeUser, syncCatalogToAllWorkspaces } from "./actions";

export default async function AdminPage({ searchParams }: {
  searchParams: Promise<{ err?: string; ok?: string; n?: string; skipped?: string }>;
}) {
  const user = await requirePage();
  if (user.email.toLowerCase() !== (env.ADMIN_EMAIL ?? "").toLowerCase()) notFound();
  const { err, ok, n, skipped } = await searchParams;

  const accounts = await db.select({
    id: clientAccount.id,
    name: clientAccount.name,
    notes: clientAccount.notes,
    createdAt: clientAccount.createdAt,
    users: sql<number>`(select count(*)::int from app_user u where u.client_account_id = ${clientAccount.id})`,
  }).from(clientAccount).orderBy(clientAccount.name);

  const users = await db.select({
    id: appUser.id,
    name: appUser.name,
    email: appUser.email,
    createdAt: appUser.createdAt,
    workspace: org.name,
    clientAccountId: appUser.clientAccountId,
  }).from(appUser).leftJoin(org, eq(appUser.orgId, org.id)).orderBy(appUser.createdAt);

  const ungrouped = users.filter((u) => !u.clientAccountId
    && u.email.toLowerCase() !== (env.ADMIN_EMAIL ?? "").toLowerCase());

  return (
    <Shell user={user} active="admin">
      <h1 className="text-2xl font-semibold">Admin console</h1>
      <p className="mt-1 max-w-2xl text-sm text-[#98A2B3]">
        Account = the client company. Users belong to an account. Each user has a private workspace
        (LinkedIn seat, connections, shortlist) — teammates do not share data.
      </p>
      {err && <p className="mt-3 text-sm text-[#B42318]">{err}</p>}

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <h2 className="text-lg font-medium">New account</h2>
        <form action={createClientAccount} className="mt-4 grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block text-sm text-[#475467]">Company name
            <input name="name" required placeholder="Ariel Group"
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm text-[#475467]">Notes
            <input name="notes" placeholder="optional"
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2.5 text-sm" />
          </label>
          <div className="flex items-end">
            <button className="rounded-[8px] bg-[#263BAA] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              Create account
            </button>
          </div>
        </form>
      </section>

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <h2 className="text-lg font-medium">Accounts <span className="tnum ml-1 text-[#98A2B3]">{accounts.length}</span></h2>
        {accounts.length === 0 && (
          <p className="mt-3 text-sm text-[#98A2B3]">No client accounts yet. Create one, then add users under it.</p>
        )}
        <ul className="mt-3 divide-y divide-[#EEF1F8]">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-4 py-3 text-sm">
              <Link href={`/admin/accounts/${a.id}`} className="min-w-0 flex-1 font-medium text-[#101828] hover:text-[#263BAA]">
                {a.name}
              </Link>
              <span className="tnum text-[#475467]">{a.users} user{a.users === 1 ? "" : "s"}</span>
              {a.notes && <span className="hidden max-w-xs truncate text-xs text-[#98A2B3] md:inline">{a.notes}</span>}
              <Link href={`/admin/accounts/${a.id}`} className="text-xs text-[#263BAA] underline">Open</Link>
            </li>
          ))}
        </ul>
      </section>

      {ungrouped.length > 0 && (
        <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
          <h2 className="text-lg font-medium">Ungrouped users</h2>
          <p className="mt-1 text-sm text-[#98A2B3]">Created before accounts existed. Assign them to a client account — workspace stays private.</p>
          <ul className="mt-3 divide-y divide-[#EEF1F8]">
            {ungrouped.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="w-40 truncate font-medium">{u.name}</span>
                <span className="tnum min-w-0 flex-1 truncate text-[#475467]">{u.email}</span>
                <form action={assignUserToAccount} className="flex items-center gap-2">
                  <input type="hidden" name="userId" value={u.id} />
                  <select name="accountId" required className="rounded-[8px] border border-[#DDE2EE] bg-white px-2 py-1.5 text-sm">
                    <option value="">Assign to…</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <button className="rounded-[8px] border border-[#DDE2EE] px-2 py-1.5 text-xs hover:bg-[#F4F6FB]">Assign</button>
                </form>
                <form action={removeUser.bind(null, u.id)}>
                  <button className="text-xs text-[#B42318]">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">Catalog</h2>
            <p className="mt-1 max-w-xl text-sm text-[#98A2B3]">
              Push your workspace&rsquo;s current services to every TTC-managed workspace.
              Client-owned catalogs are skipped.
            </p>
            {ok === "synced" && (
              <p className="mt-2 text-sm text-[#263BAA]">
                Catalogue synced to {n} workspace(s).
                {Number(skipped) > 0 && ` ${skipped} client workspace(s) skipped.`}
              </p>
            )}
          </div>
          <form action={syncCatalogToAllWorkspaces}>
            <button className="rounded-[8px] border border-[#263BAA]/40 bg-[#EEF1FC] px-4 py-2 text-sm font-medium text-[#263BAA] hover:bg-[#EEF1FC]">
              Sync catalog to all workspaces
            </button>
          </form>
        </div>
      </section>
    </Shell>
  );
}

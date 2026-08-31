import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db, appUser, org, clientAccount, channelAccount } from "@/db";
import { Shell, requirePage } from "@/app/shell";
import { env } from "@/lib/env";
import { addUser, removeUser, renameClientAccount } from "../../actions";

export default async function AdminAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ err?: string; ok?: string }>;
}) {
  const user = await requirePage();
  if (user.email.toLowerCase() !== (env.ADMIN_EMAIL ?? "").toLowerCase()) notFound();
  const { id } = await params;
  const { err, ok } = await searchParams;

  const [acct] = await db.select().from(clientAccount).where(eq(clientAccount.id, id)).limit(1);
  if (!acct) notFound();

  const members = await db.select({
    id: appUser.id,
    name: appUser.name,
    email: appUser.email,
    orgId: appUser.orgId,
    createdAt: appUser.createdAt,
    workspace: org.name,
  }).from(appUser)
    .leftJoin(org, eq(appUser.orgId, org.id))
    .where(eq(appUser.clientAccountId, id))
    .orderBy(appUser.createdAt);

  const orgIds = members.map((m) => m.orgId);
  const seats = orgIds.length
    ? await db.select().from(channelAccount).where(inArray(channelAccount.orgId, orgIds))
    : [];
  const seatByOrg = new Map(seats.map((s) => [s.orgId, s]));

  return (
    <Shell user={user} active="admin">
      <p className="text-sm text-[#98A2B3]">
        <Link href="/admin" className="text-[#263BAA] underline">Console</Link>
        {" / "}Account
      </p>
      <h1 className="mt-1 text-2xl font-semibold">{acct.name}</h1>
      <p className="mt-1 text-sm text-[#98A2B3]">
        {members.length} user{members.length === 1 ? "" : "s"} — each with a private workspace. They do not share connections or shortlists.
      </p>
      {err && <p className="mt-3 text-sm text-[#B42318]">{err}</p>}
      {ok === "1" && <p className="mt-3 text-sm text-[#067647]">User added with a private workspace. Share the password; they will change it on first login.</p>}
      {ok === "saved" && <p className="mt-3 text-sm text-[#067647]">Account saved.</p>}

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <h2 className="text-lg font-medium">Account</h2>
        <form action={renameClientAccount.bind(null, acct.id)} className="mt-4 grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block text-sm text-[#475467]">Name
            <input name="name" required defaultValue={acct.name}
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm text-[#475467]">Notes
            <input name="notes" defaultValue={acct.notes ?? ""}
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2.5 text-sm" />
          </label>
          <div className="flex items-end">
            <button className="rounded-[8px] border border-[#DDE2EE] px-4 py-2.5 text-sm hover:bg-[#F4F6FB]">Save</button>
          </div>
        </form>
      </section>

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <h2 className="text-lg font-medium">Add user</h2>
        <form action={addUser} className="mt-4 grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
          <input type="hidden" name="accountId" value={acct.id} />
          <label className="block text-sm text-[#475467]">Name
            <input name="name" required placeholder="Adam Pingel"
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm text-[#475467]">Email
            <input name="email" type="email" required placeholder="adam@client.com"
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm text-[#475467]">Temporary password
            <input name="password" type="text" required minLength={8} placeholder="min 8 characters"
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm text-[#475467]">Offers in their workspace
            <select name="catalogMode"
              className="mt-1.5 w-full rounded-[10px] border border-[#DDE2EE] bg-white px-3 py-2.5 text-sm">
              <option value="own">Their own offers (external client)</option>
              <option value="managed">TTC catalogue (internal seat)</option>
            </select>
          </label>
          <div>
            <button className="rounded-[8px] bg-[#263BAA] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1D2E86]">
              Add user
            </button>
          </div>
        </form>
      </section>

      <section className="mt-6 bg-white border border-[#DDE2EE] rounded-[14px] shadow-[0_1px_2px_rgba(16,24,40,.04)] p-5">
        <h2 className="text-lg font-medium">Users <span className="tnum ml-1 text-[#98A2B3]">{members.length}</span></h2>
        {members.length === 0 && <p className="mt-3 text-sm text-[#98A2B3]">No users on this account yet.</p>}
        <ul className="mt-3 divide-y divide-[#EEF1F8]">
          {members.map((u) => {
            const seat = seatByOrg.get(u.orgId);
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="w-40 truncate font-medium">{u.name}</span>
                <span className="tnum min-w-0 flex-1 truncate text-[#475467]">{u.email}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] ${
                  seat?.status === "operational" ? "bg-[#ECFDF3] text-[#067647]"
                    : "bg-[#F4F6FB] text-[#475467]"
                }`}>
                  {seat ? (seat.displayName ?? "LinkedIn linked") : "no LinkedIn"}
                </span>
                <span className="tnum text-xs text-[#98A2B3]">since {u.createdAt.toISOString().slice(0, 10)}</span>
                <form action={removeUser.bind(null, u.id, acct.id)}>
                  <button className="text-xs text-[#B42318]">Remove</button>
                </form>
              </li>
            );
          })}
        </ul>
      </section>
    </Shell>
  );
}

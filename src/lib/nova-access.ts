/** Nova is off for named seats. Match first name or email local-part. */
const HIDDEN = ["ariel"];

export function novaHidden(user: { email?: string | null; name?: string | null }): boolean {
  const name = (user.name ?? "").toLowerCase();
  const email = (user.email ?? "").toLowerCase();
  const local = email.split("@")[0] ?? "";
  return HIDDEN.some((n) =>
    new RegExp(`\\b${n}\\b`, "i").test(name) || local === n || local.startsWith(`${n}.`) || local.startsWith(`${n}+`),
  );
}

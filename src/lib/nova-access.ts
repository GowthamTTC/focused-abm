/** Nova is off for the Ariel Group seat (Adam / apingel@arielgroup.com). */
const HIDDEN_DOMAINS = ["arielgroup.com"];
const HIDDEN_EMAILS = ["apingel@arielgroup.com"];
const HIDDEN_NAMES = ["ariel"];

export function novaHidden(user: { email?: string | null; name?: string | null }): boolean {
  const name = (user.name ?? "").toLowerCase().trim();
  const email = (user.email ?? "").toLowerCase().trim();
  const domain = email.split("@")[1] ?? "";
  if (HIDDEN_EMAILS.includes(email)) return true;
  if (HIDDEN_DOMAINS.includes(domain)) return true;
  return HIDDEN_NAMES.some((n) => new RegExp(`\\b${n}\\b`, "i").test(name));
}

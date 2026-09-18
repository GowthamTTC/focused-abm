/**
 * Features switched off for one seat.
 *
 * The Ariel Group seat (Adam / apingel@arielgroup.com) does not get Nova, and
 * as of v2.15.0 does not get Social either. One predicate, matched three ways —
 * email, domain, then a word in the display name — because a seat can arrive
 * through an invite under a different address and the point is to be hard to
 * slip past, not to be exact.
 *
 * Each feature gets its OWN exported function even though both currently
 * delegate to the same predicate. They are separate product decisions and will
 * diverge the moment one seat wants one and not the other; a shared
 * `isHiddenSeat` at the call sites would make that a rewrite instead of an edit.
 */
const HIDDEN_DOMAINS = ["arielgroup.com"];
const HIDDEN_EMAILS = ["apingel@arielgroup.com"];
const HIDDEN_NAMES = ["ariel"];

function arielSeat(user: { email?: string | null; name?: string | null }): boolean {
  const name = (user.name ?? "").toLowerCase().trim();
  const email = (user.email ?? "").toLowerCase().trim();
  const domain = email.split("@")[1] ?? "";
  if (HIDDEN_EMAILS.includes(email)) return true;
  if (HIDDEN_DOMAINS.includes(domain)) return true;
  return HIDDEN_NAMES.some((n) => new RegExp(`\\b${n}\\b`, "i").test(name));
}

export function novaHidden(user: { email?: string | null; name?: string | null }): boolean {
  return arielSeat(user);
}

/** Social is the unfiltered 1st-degree post feed at /social. */
export function socialHidden(user: { email?: string | null; name?: string | null }): boolean {
  return arielSeat(user);
}

/**
 * Self-serve /signup is a private beta of one seat while the onboarding
 * wizard is shaken out — everyone else still gets an admin-provisioned
 * account. Domain-first like the Ariel gate, so any address on the
 * allowed domain gets in rather than one exact inbox.
 */
const SIGNUP_ALLOWED_DOMAINS = ["tossthe.co.in"];
const SIGNUP_ALLOWED_EMAILS = ["gowtham@tossthe.co.in"];

export function signupAllowed(email: string): boolean {
  const e = email.toLowerCase().trim();
  const domain = e.split("@")[1] ?? "";
  return SIGNUP_ALLOWED_EMAILS.includes(e) || SIGNUP_ALLOWED_DOMAINS.includes(domain);
}

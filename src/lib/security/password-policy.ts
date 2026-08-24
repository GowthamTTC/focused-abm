/**
 * Password rules aligned with common US NIST SP 800-63B guidance
 * (length over complex composition) and practical Indian enterprise baselines.
 */
const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "admin123", "welcome1", "letmein1", "iloveyou", "abc12345",
  "passw0rd", "changeme", "changeme1", "tossthecoin", "focusedabm",
]);

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

export function checkPassword(password: string, email?: string): PasswordCheck {
  if (password.length < 12) {
    return { ok: false, reason: "Password must be at least 12 characters." };
  }
  if (password.length > 128) {
    return { ok: false, reason: "Password is too long." };
  }
  if (/^\s|\s$/.test(password)) {
    return { ok: false, reason: "Password cannot start or end with a space." };
  }
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) {
    return { ok: false, reason: "Password is too common." };
  }
  if (email) {
    const local = email.toLowerCase().split("@")[0] ?? "";
    if (local.length >= 3 && lower.includes(local)) {
      return { ok: false, reason: "Password cannot contain your email name." };
    }
  }
  // Prefer length; still require mixed character classes for enterprise comfort.
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes < 3) {
    return {
      ok: false,
      reason: "Use at least 3 of: lowercase, uppercase, number, symbol.",
    };
  }
  return { ok: true };
}

/**
 * The account brief as a PDF that looks like the app, because it IS the app.
 *
 * A generated document drifts: the page gains a band, the export does not, and
 * a month later the PDF a client sees is a different product from the one on
 * screen. So this drives a headless browser over the real page, with the
 * requester's own session cookie, and prints what comes back. Chrome keeps
 * every anchor live in the output, so the evidence is still one click away.
 *
 * The cost is honest: it needs a Chromium on the host and about a second per
 * export. CHROME_PATH points at it; without one the caller falls back to the
 * drawn version rather than failing.
 */
import puppeteer from "puppeteer-core";
import { env } from "@/lib/env";

/** Where a browser might be, in the order worth trying. */
const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/root/.nix-profile/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean) as string[];

export function chromePath(): string | null {
  const fs = require("node:fs") as typeof import("node:fs");
  for (const p of CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch { /* keep looking */ }
  }
  return null;
}

export async function renderAccountPdf(input: {
  /** Path on this app, already carrying focus and alias. */
  path: string;
  /** The caller's cookie header, so the render sees what they see. */
  cookie: string;
}): Promise<Buffer | null> {
  const executablePath = chromePath();
  if (!executablePath) return null;

  const base = (env.APP_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
  const url = `${base}${input.path}${input.path.includes("?") ? "&" : "?"}print=1`;

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1600 });
    // The session is forwarded as COOKIES, not as a cookie header: Chrome
    // ignores a cookie set through extra headers, and the render silently
    // lands on the login page — which then prints as a one-page PDF of a login
    // form. A service account is not used on purpose: the export must contain
    // exactly what this user is allowed to see and nothing more.
    const host = new URL(base).hostname;
    const jar = input.cookie.split(";").map((c) => c.trim()).filter(Boolean).map((c) => {
      const i = c.indexOf("=");
      return { name: c.slice(0, i), value: c.slice(i + 1), domain: host, path: "/" };
    }).filter((c) => c.name);
    if (jar.length > 0) await page.setCookie(...jar);
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });
    // A render that landed on the login page would print as a one-page PDF of
    // a login form, which looks like a product bug rather than an auth one.
    // Say so, and let the caller fall back to the drawn version.
    if (/\/login/.test(page.url())) {
      console.warn(`[account-pdf] render bounced to login: ${page.url()} (cookies: ${input.cookie.split(";").length})`);
      return null;
    }
    // Open everything that collapses, so no section prints as a bare heading.
    await page.evaluate(() => {
      document.querySelectorAll("details").forEach((d) => { d.open = true; });
      document.documentElement.setAttribute("data-printing", "1");
    });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
      preferCSSPageSize: false,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

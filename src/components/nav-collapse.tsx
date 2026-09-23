"use client";
/** Hide the sidebar, and remember that you did.
 *
 *  The state lives on <html data-nav>, not in React, so the whole shell does
 *  not have to become a client component to answer one question. It is written
 *  to localStorage and read back by a script that runs before paint, so a
 *  reload does not flash the sidebar open for a frame before hiding it. */
import { useEffect, useState } from "react";

const KEY = "nav-collapsed";

/** Runs before first paint, inline in <head>. Wrapped in try/catch because a
 *  browser with storage blocked must still render the app. */
export const NAV_BOOT = `try{if(localStorage.getItem('${KEY}')==='1')document.documentElement.setAttribute('data-nav','collapsed')}catch(e){}`;

export function NavCollapse() {
  const [collapsed, setCollapsed] = useState(false);

  // Mirror whatever the boot script already decided, so the button's arrow
  // points the right way on first render.
  useEffect(() => {
    setCollapsed(document.documentElement.getAttribute("data-nav") === "collapsed");
  }, []);

  return (
    <button
      type="button"
      aria-label={collapsed ? "Show the sidebar" : "Hide the sidebar"}
      title={collapsed ? "Show the sidebar" : "Hide the sidebar"}
      onClick={() => {
        const next = !collapsed;
        setCollapsed(next);
        const root = document.documentElement;
        if (next) root.setAttribute("data-nav", "collapsed");
        else root.removeAttribute("data-nav");
        try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* private window */ }
      }}
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] border border-[#DDE2EE] text-[#667085] transition-colors duration-[130ms] hover:border-[#98A2B3] hover:text-[#101828]"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
        {collapsed && <line x1="3.1" y1="8" x2="4.6" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
      </svg>
    </button>
  );
}

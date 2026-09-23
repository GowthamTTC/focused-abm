"use client";
/** Export the page as a PDF, through the browser's own printer.
 *
 *  No server-side renderer and no second copy of the page to keep in sync: the
 *  thing exported IS the page, which is the only way an export cannot drift
 *  from what the reader saw. Chrome's "Save as PDF" keeps anchors live, so
 *  every profile, post and article in the export is still one click away.
 *
 *  Two things have to happen before the dialog opens, and be undone after:
 *  every <details> is forced open, because a collapsed one prints as a heading
 *  with nothing under it; and the page is told it is printing, so the CSS can
 *  release the scroll boxes that would otherwise print their first 32rem and
 *  silently drop the rest.
 */
export function PrintButton({ className, label = "Export PDF" }: {
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const root = document.documentElement;
        const opened: HTMLDetailsElement[] = [];
        document.querySelectorAll("details").forEach((d) => {
          if (!d.open) { d.open = true; opened.push(d); }
        });
        root.setAttribute("data-printing", "1");

        const restore = () => {
          root.removeAttribute("data-printing");
          opened.forEach((d) => { d.open = false; });
          window.removeEventListener("afterprint", restore);
        };
        window.addEventListener("afterprint", restore);

        // A frame, so the layout has actually reflowed with the print
        // attribute before the dialog freezes it.
        requestAnimationFrame(() => {
          window.print();
          // Safari does not always fire afterprint; this is the safety net.
          setTimeout(restore, 1000);
        });
      }}
    >
      {label}
    </button>
  );
}

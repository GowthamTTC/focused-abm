import Link from "next/link";
import { STEPS } from "./progress";

export function StepIndicator({ current, reached }: { current: number; reached: number }) {
  return (
    <ol className="flex flex-wrap gap-2">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const done = n <= reached;
        const isCurrent = n === current;
        const open = n <= reached + 1;
        const tone = isCurrent
          ? "border-[#263BAA] bg-[#263BAA] text-white"
          : done
            ? "border-[#C7CFEA] bg-[#EEF1FB] text-[#263BAA]"
            : "border-[#DDE2EE] bg-white text-[#98A2B3]";
        const body = (
          <span className={`flex items-center gap-2 rounded-[10px] border px-3 py-1.5 text-xs font-medium ${tone}`}>
            <span className="tabular-nums opacity-70">{n}</span>
            {s.title}
          </span>
        );
        return (
          <li key={s.title}>
            {open && !isCurrent
              ? <Link href={`/onboarding/${n}`} className="block hover:opacity-80">{body}</Link>
              : body}
          </li>
        );
      })}
    </ol>
  );
}

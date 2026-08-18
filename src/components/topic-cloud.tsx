export function TopicCloud({ terms, people }: {
  terms: { term: string; n: number }[]; people: number;
}) {
  if (terms.length === 0) return (
    <p className="text-sm text-[#98A2B3]">
      Appears once prospects have been researched — the cloud is built from their recorded signals.
    </p>
  );
  const max = terms[0].n, min = terms[terms.length - 1].n;
  const size = (n: number) => 12 + Math.round(((n - min) / Math.max(1, max - min)) * 14);
  const shade = (n: number) => n >= max * 0.66 ? "#263BAA" : n >= max * 0.33 ? "#4358D4" : "#8B95AE";
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        {terms.map((t) => (
          <span key={t.term} title={`${t.n} researched prospects`} className="tnum leading-tight"
            style={{ fontSize: size(t.n), color: shade(t.n), fontWeight: t.n >= max * 0.66 ? 600 : 500 }}>
            {t.term}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs text-[#98A2B3]">
        From the recorded signals of {people.toLocaleString()} researched prospects — real reads, not network-wide guesses.
      </p>
    </div>
  );
}

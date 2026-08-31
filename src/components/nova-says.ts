export const NOVA_SAYS: string[] = [
  "Patience is a warm intro wearing a tie.",
  "Even a rolling stone checks LinkedIn first.",
  "A watched enrich never boils \u2014 until it does.",
  "Don't count VPs before they pitch.",
  "The early bird still needs a first-degree graph.",
  "All that glitters is not ICP.",
  "Rome wasn't matched in a day.",
  "A stitch in time saves a cold email.",
  "Look before you enrich.",
  "Too many cooks, one buying committee.",
  "You can lead a VP to Radar, but you can't make them post.",
  "Fortune favors the shortlisted.",
  "A bird in the network is worth two in Apollo.",
  "Don't put all your champions in one account.",
  "Slow and steady scans the event.",
  "When in doubt, star the company.",
  "The squeaky pipeline gets the draft.",
  "Measure twice, enrich once.",
  "Idle hands draft generic openers.",
  "Strike while the post is hot.",
  "A closed mouth gathers no replies.",
  "Don't cry over skipped contacts.",
  "The grass is greener on the shortlist.",
  "Beggars can't be 3rd degree.",
  "Every cloud has a silver ICP.",
  "Actions speak louder than headlines.",
  "Better a small list than a large shrug.",
  "Curiosity scanned the cat \u2014 and the CFO.",
  "No pain, no matchWhy.",
  "The pot calling the kettle off-ICP.",
  "Don't burn the midnight Unipile.",
  "A rising tide lifts all accounts. Slightly.",
  "You miss 100% of the scans you don't start.",
  "Talk is cheap. Tokens aren't.",
  "If the shoe fits, it's probably a VP.",
  "Don't count your drafts before they're ready.",
  "A fool and his credits are soon enriched.",
  "Still waters run deep \u2014 and rarely post.",
  "The proof of the pudding is in the send.",
  "Many hands make light shortlists.",
  "Leave no champion behind. Maybe one.",
  "A journey of a thousand connections starts with sync.",
  "What's sauce for the CXO is sauce for the director.",
  "You can't make an omelette without breaking a daily cap.",
  "Silence is golden. Ready drafts are gold-er.",
  "Don't teach your grandmother to geofence.",
  "The best time to scan was last week. The second best is now.",
  "A rolling quota gathers no moss.",
  "Keep your friends close and your 2nd degree closer.",
  "If at first you don't match, classify again.",
  "There's no such thing as a free lookalike.",
  "The cobbler's children have unenriched profiles.",
  "Don't spoil the ship for a ha'penny of Haiku.",
  "Good things come to those who poll the job table.",
  "A penny saved is a Sonnet not called.",
  "You can't have your cake and skip Stage B.",
  "When the going gets tough, Nova gets proverbial.",
  "All work and no Radar makes Jack a dull AE.",
  "Don't throw the baby out with the off-ICP bathwater.",
  "The devil is in the company_key.",
  "A rising CHRO lifts all HR comms.",
  "Never look a gift 1st-degree in the mouth.",
  "The best defense is a good shortlist.",
  "Walk softly and carry a big ICP.",
  "One person's peer is another person's pitch.",
  "If you want peace, prepare the send queue.",
  "Don't put new wine in old CSVs.",
  "A house divided cannot agree on the budget owner.",
  "The longest journey is the last 12 seconds of Unipile.",
  "Haste makes duplicate enrich jobs.",
  "Better late than 401 from the seat.",
  "A watched webhook never claims.",
  "Not all who wander are off the ICP.",
  "The map is not the metro.",
  "Even a stopped clock is right twice \u2014 unlike a stale post.",
  "Don't count the committee before the seats show up.",
  "A rising event fills all Radars.",
  "You can't step in the same pipeline twice.",
  "The unexamined network is not worth pitching.",
  "To enrich or not to enrich \u2014 that is the credit.",
  "All models are wrong. Some drafts are useful.",
  "May the odds be ever in your matchConfidence.",
  "In the land of the blind, the one-eyed AE is Head of Sales.",
  "A camel is a horse designed by a buying group.",
  "Don't attribute to malice what fits 'pending'.",
  "Perfect is the enemy of queued.",
  "The beatings will continue until the job status is done.",
  "Here be 3rd-degree dragons.",
  "Abandon hope, all ye who enter without a seat.",
  "This too shall enrich.",
  "Winter is coming. So is lastPostAt.",
  "One does not simply walk into Stage B.",
  "That's no moon. That's a holding company.",
  "I've got a good feeling about this account.",
  "Do or do not. There is no skipped \u2014 wait, there is.",
  "Live long and shortlist.",
  "Resistance is futile. The catalog will be synced.",
  "With great network comes great follow-up.",
  "To infinity, and beyond the 7-day window.",
  "May your coffee be strong and your ICP stricter."
];

/** Shuffle-bag: every line once before any repeat. Last used never leads the next bag. */
let bag: number[] = [];
let last = -1;

function shuffle(n: number, avoid: number) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  if (a.length > 1 && a[0] === avoid) {
    const k = 1 + Math.floor(Math.random() * (a.length - 1));
    [a[0], a[k]] = [a[k]!, a[0]!];
  }
  return a;
}

export function nextSaying(): number {
  if (bag.length === 0) bag = shuffle(NOVA_SAYS.length, last);
  last = bag.pop()!;
  return last;
}

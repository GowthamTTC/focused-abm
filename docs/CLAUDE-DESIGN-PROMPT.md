# Claude Design Prompt — Focused ABM

Paste everything below the line into Claude Design. It is self-contained: product
context, design direction, component system, and every screen with its states.
Generate desktop-first (1440px), with a usable 1024px variant; mobile is read-only
monitoring, not a build target.

---

## What you are designing

**Focused ABM** — an internal tool for a B2B marketing agency ("toss the coin", ~1–3
senior operators). It turns a person's LinkedIn 1st-degree connections (≈5,000 rows)
into a ranked ABM workbook through two stages:

- **Stage A (grey):** cheap metadata classification of every connection into four
  buckets — Pitchable / Off-ICP / Peers & Competitors / Excluded — plus a provisional
  service pick, a one-line "why", a score, a tier (T1/T2/T3), and a rank.
- **Stage B (amber):** for a hand-picked Top N (default 30), the tool reads the real
  LinkedIn profile and recent posts, then fills the "amber columns": About summary,
  posts summary, pain points (explicitly **marked "(inferred)"** when the person
  doesn't post — most don't), service confirm/correct/**FLAG**, and a drafted DM.
- The output is a five-tab Excel workbook the team already uses; in that workbook
  grey cells = machine-matched metadata, amber cells = machine-scanned profile work.

The product's soul is **provenance**: every verdict shows its "why", every inference
is labeled as one, machine-verified and machine-scanned data never look the same.
This is a ledger you can trust, not a dashboard that performs.

## Design direction (follow exactly)

**Mood:** calm operations ledger. Spreadsheet-grade density with editorial confidence.
Nothing gamified, nothing "AI-sparkle" (no gradients, no glassmorphism, no robot/spark
iconography). The AI is a diligent clerk whose work is always inspectable.

**Palette (semantic, not decorative):**
- `paper` #F7F7F5 — app background (cool paper, not cream)
- `ink` #17191E — primary text; also the primary button fill
- `rule` #DEDFDB — hairlines, table rules
- `stageA-grey` #E9EAE6 (fill) / `slate` #5A6472 (text/labels) — everything Stage A
- `stageB-amber` #F5E5C0 (fill) / `amber-ink` #8A5A00 (text), `amber-accent` #C77D0A
  (actions) — everything Stage B. **Amber is meaning, not branding: it may only
  appear on Stage-B data, Stage-B actions, and selection-for-enrichment.**
- `verify-green` #1E7A5A — export/done. `flag-red` #B3402F — FLAGs and failures only.

**Type:** Display/headers: **Bricolage Grotesque** (semibold, tight tracking) — used
sparingly: page titles, batch names, big counts. Body/UI: **IBM Plex Sans**. Data,
IDs, scores, table numerics: **IBM Plex Mono** with tabular numerals. Type scale:
26/18/15/13/12; data tables run at 13px with 20px row rhythm.

**Signature element — the Ledger Strip:** every batch is summarized by a full-width,
10px-tall strip of 1px vertical ticks, one tick per connection, in reading order of
rank: slate ticks (pitchable), light-grey (excluded), dust (off-ICP), blue-grey
(peers), and **amber ticks for the selected Top N**, which sit at the far left and
visibly "catch fire" as enrichment completes (amber → deep amber). It compresses
5,000 people into one honest object, reads as a spectrum of the person's network,
and is the one place the design is allowed to be beautiful. It appears on batch
cards (small) and batch headers (large, with hover tooltip: "rank 214 · pitchable ·
demand-gen").

**Everything else stays quiet:** flat surfaces, 6px radius, 1px rules, no shadows
beyond a 1px border on raised menus. Motion: only three — job progress bars, ticks
igniting on the Ledger Strip, and row-status chip transitions; all ≤200ms and
disabled under reduced-motion.

**Copy voice:** plain verbs, sentence case, specifics over adjectives. Buttons name
the action + object ("Run matching", "Select top 30", "Export workbook"). Errors say
what happened + the next step. Never "Oops", never exclamation marks.

## Component system

- **Bucket chip:** small rectangle chip (not pill) — Pitchable (slate on stageA-grey),
  Off-ICP (dust), Peers (blue-grey), Excluded (outline only).
- **Stage cells:** table cells carry their stage — Stage-A columns on faint grey
  fill, Stage-B columns on faint amber fill, exactly like the workbook.
- **Why-popover:** every score/verdict is clickable → popover with the one-line why
  + mono score breakdown (seniority 34 · function 12 · confidence 26 · founder 0 ·
  company 5 = 77 → T1) + "rule pass" or "model pass" provenance tag.
- **Inferred tag:** amber-outline micro-tag `inferred` beside any pain-point text
  produced without posts.
- **FLAG tag:** red-outline `⚑ flag` + short reason; row keeps working, never hidden.
- **Job banner:** slim bar under the header when the worker runs: "Matching · 2,150 /
  4,990" with a thin progress line; failed jobs render the same bar in flag-red with
  the error text and a "Retry" action.
- **Primary/secondary buttons:** ink fill / 1px ink outline. Stage-B actions
  (Select top N, Deep enrich) use amber-accent. Export uses verify-green.
- **Tables:** sticky header, 13px, zebra-free (rules only), row hover = paper darken,
  sortable rank/score/tier columns, sticky first two columns on overflow.

## Screens

### 1. Login
Centered 360px card on paper. Wordmark "Focused ABM" in Bricolage, one-line promise
under it: "Connections → ranked batches → workbook." Email, password, ink "Sign in".
Error state: single red line above fields, "Wrong email or password." Nothing else on
the page — no illustration.

### 2. App shell
Slim top bar (56px): wordmark left; nav center-left — Connections · Services ·
Settings (active = ink + 2px underline); right — user email · "Sign out" as quiet
text. Content column max 1200px. The job banner docks directly under this bar,
app-wide, whenever a job runs.

### 3. Connections (home)
Two side-by-side import cards:
- **Sync from LinkedIn** — "Pull all 1st-degree connections through the connected
  account." Primary button "Sync connections". If no operational seat: button
  disabled + inline note "Connect a LinkedIn account in Settings first" with link.
- **Upload Connections.csv** — helper line with the exact LinkedIn export path,
  file drop-zone, secondary "Upload".
Below: **Batches** list — each row: batch label (Bricolage 15), source chip
csv/sync, created date, mini Ledger Strip, and right-aligned mono counts
"4,502 pitchable · 85 off-ICP · 114 peers". Empty state: dashed drop-zone card,
"No batches yet — sync or upload above." Loading state for a just-created batch:
row with skeleton strip + "importing…".

### 4. Batch — Pool (the core screen)
Header: batch name, source + date; the **large Ledger Strip** under it; toolbar right:
- "Run matching (4,990)" (ink) — only while unclassified rows exist;
- "Select top [30] ▸" numeric stepper + amber button — after ranking exists;
- "Deep enrich queued" (amber) — after a selection exists;
- "Export workbook" (green outline; solid once ≥1 enriched row).
Tabs under the strip: **Pitchable (4,502) · Batch (12 done) · Off-ICP (85) ·
Peers (114) · Excluded (289)**.

**Pitchable table** columns: Rank (mono) · Tier chip · Name (link) · Company ·
Position · Service (chip, stageA-grey fill) · Why (truncated, opens why-popover) ·
Score (mono, popover). Selected-for-enrichment rows get a 3px amber left edge +
faint amber wash. Row states: default / hover / selected. Header shows "Top 30
selected — 18 queued · 12 done" when a selection exists.
Off-ICP & Peers tables: Name · Company · Position · Why flagged; a quiet row action
"Move to pitchable" (secondary, rare).
States: unclassified batch → table area shows a single instruction card
("Run matching to classify 4,990 connections into buckets."); matching running →
job banner + rows fill in live (no skeleton table, real rows appear).

### 5. Batch — Enrichment view ("Batch" tab)
The Top N as a two-pane layout. Left: compact list — rank, name, enrich-status chip
(queued grey / running amber-pulse / done green / failed red), FLAG marker. Right:
**record card** for the focused person, laid out exactly in workbook column order,
each field labeled with a tiny stage swatch:
- grey group: Company · Position · Provisional service · Why;
- amber group: **About — summary** · **Posts** (activity-feed link + summary; if
  none: "No original posts found" + the summary still present) · **Pain points**
  (with `inferred` tag when applicable) · **Service to pitch** (confirmed = plain;
  corrected = old slug struck through → new + reason line; flagged = red FLAG tag +
  reason) · **Outreach message** in a message well (max-width 560px, comfortable
  16px/1.6 reading) with "Copy message" + "Open profile" actions.
Failed record state: red chip, the stored error line, "Retry this person" (re-queues).
Progress header: "Deep enrichment · 12 of 30 · ~40s per person" while running.
Empty state (nothing selected yet): instruction card "Select top N in the Pool tab
to build a batch."

### 6. Services
Grid of six cards (2×3): service name (Bricolage 15), one-line summary, mono meta
"3 personas · 4 pains", status. Click → **ICP editor**: left column = structured
form (Summary textarea; Fit signals, Pain points, Disqualifiers as tag-list inputs;
Personas as repeatable cards with title-include / title-exclude tag inputs, seniority
multiselect, function tags); right column = sticky explainer card: "These patterns
drive the free rule pass — every pattern you add removes people from the paid model
pass." Save = ink button; saved toast "ICP saved — re-run matching to apply."
Include the raw-JSON fallback view behind a quiet "Edit as JSON" toggle.

### 7. Settings
Two sections. First: **Enrichment guardrail** — segmented control of six options
(5 · 10 · 15 · 25 · 50 · Full list), selected = ink fill; helper text "Maximum people
one deep-enrichment run may process — your spend brake. The hard daily ceiling of
80/day always applies on top." When "Full list" is selected, an amber caution line
appears: "Runs bounded only by the daily cap — intended for the endgame, not week
one." Saved state: quiet toast "Guardrail saved." The batch toolbar echoes this as
a small "guardrail 25" tag beside Select top N, linking here.
Second: **LinkedIn account**. Explains: "The connected account is used to sync
your connections and read Top-N profiles." Primary "Connect LinkedIn".
Seat list states: operational (green chip) / needs re-auth (amber chip + "Reconnect")
/ disconnected (grey). Mock-mode note when no API keys: slate info line "Running in
mock mode — add Unipile keys to go live." Show "Last synced 2h ago" under the seat.

### 8. Export moment
Not a screen — a confirmation. Clicking "Export workbook" pops a small summary card:
five tab names with row counts (Instructions · Top 30 · Target Pool 4,502 · Review 85
· Peers 114), a one-line reminder "Grey = matched from metadata · Amber = read from
profile", and "Download .xlsx" (green). Below the tab list, one quiet slate checkbox:
**"Include Ops tab (internal diagnostics)"** — default OFF, helper text "score
breakdowns, confidence, provenance, enrichment status. For internal QA — remove
before sharing externally." When ticked, a sixth line appears in the summary: "Ops ·
full diagnostics". After download: toast "Workbook exported."

## Global states
- **Empty:** every empty state is an instruction to act, styled as a dashed card —
  never an illustration of a mascot.
- **Loading:** job banner + live rows; skeletons only for first paint of lists.
- **Errors:** inline, specific, with the next step ("Unipile rate limit hit — the
  worker will resume automatically; rows stay queued.").
- **Destructive/none:** there is no delete in v1 — do not design one.

## Accessibility & quality floor
Visible keyboard focus (2px ink offset ring), all chips pass 4.5:1 on their fills,
the Ledger Strip has a text equivalent (the counts line), tables navigable by
keyboard, reduced-motion kills the tick-ignition animation. Sentence-case labels
throughout; tabular numerals in every numeric column.

## Deliver
High-fidelity mockups for screens 1–8 including each listed state (pool: pre-match /
matching-running / ranked+selected; enrichment: running / done / failed / flagged;
settings: mock / operational / needs-reauth), plus a one-page component sheet
(chips, cells, popover, banner, buttons, Ledger Strip anatomy).

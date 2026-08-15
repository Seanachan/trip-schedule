// ============================================
// Trip Schedule — parsed from an Obsidian markdown export
// ============================================
//
// The Obsidian vault note (synced into src/content/trip/*.md) is the SINGLE
// SOURCE OF TRUTH — not this file, and not a Notion export. There are two
// notes in that folder:
//   - the itinerary note: identified by containing a "## 每日行程" heading
//     (the filename itself has spaces/full-width parens, so we don't hardcode it)
//   - the "avoid list" note: whatever the other file is
//
// Everything below is pure string parsing — this module runs in the browser,
// so no Node fs/path APIs. See parseTripMarkdown() / parseAvoidList() for the
// entry points; the smaller helpers above them are exported where a unit
// test benefits from calling them directly with a synthetic fixture.

export type CategoryKey = "交通" | "住宿" | "美食" | "景點" | "購物";

export interface Place {
  name: string;
  /** Undefined when the note only gave a name and no `@lat,lng` suffix. */
  lat?: number;
  lng?: number;
}

export interface ScheduleLink {
  label: string;
  url: string;
}

export interface DayItem {
  title: string;
  /** Local HH:MM. */
  time: string;
  /** What actually happened (「實際」column); undefined until filled in. */
  actualTime?: string;
  type: CategoryKey;
  /** GPS place from the 地點 column; null when the row has no location set. */
  place: Place | null;
  /** The 備註 cell's own text — written to be skimmed in one line. */
  notes: string;
  /** Long-form prose pulled in from the row's `[^label]` footnotes, kept out
   * of `notes` so the card can show it as a separate, collapsible block. */
  detail?: string;
  cost?: string | null;
  booking?: string | null;
  links: ScheduleLink[];
  /** 「✓」column — true once the row is marked done. */
  done: boolean;
  /** 「紀錄」column — freeform after-the-fact note; undefined until filled in. */
  log?: string;
}

export interface TripDay {
  /** YYYY-MM-DD. */
  date: string;
  city: string;
  theme: string;
  items: DayItem[];
}

export interface Flight {
  seg: string;
  date: string;
  dep: string;
  arr: string;
  flightNo: string;
}

export interface Trip {
  title: string;
  subtitle: string;
  budget: string;
  flights: Flight[];
}

export interface Practical {
  交通: string[];
  住宿: string[];
  天氣: string;
  app: string;
  避雷清單: string[];
}

/** One row of the "## 🗓️ 行程總覽" summary table — used only for the
 * consistency check against the per-day `### Day N` headings, never as a
 * data source. */
export interface OverviewRow {
  date: string;
  city: string;
  theme: string;
}

export interface ParsedTripMarkdown {
  trip: Trip;
  days: TripDay[];
  practical: Omit<Practical, "避雷清單">;
  overview: OverviewRow[];
}

// ---------------------------------------------------------------------------
// generic markdown-table helpers
// ---------------------------------------------------------------------------

/**
 * Split one `| a | b |` table row into trimmed, unescaped cells.
 * `\|` is treated as a literal pipe (not a column separator) — the
 * full-width `｜` used throughout note text as an internal separator is a
 * different character and is left untouched. `<br>` becomes a real newline.
 */
function splitTableRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "|") {
      current += "|";
      i++;
    } else if (ch === "|") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.replace(/<br\s*\/?>/gi, "\n").trim());
}

/** Extract the data rows of the first markdown table in `blockLines` — the
 * header row and the `| --- |` separator row are skipped. */
function extractTableRows(blockLines: string[]): string[][] {
  const tableLines = blockLines.filter((l) => l.trim().startsWith("|"));
  if (tableLines.length < 2) return [];
  return tableLines.slice(2).map(splitTableRow);
}

/** True for a level-2 `## Heading` line (but not a level-3 `### Heading`). */
function isH2(line: string): boolean {
  return /^##\s/.test(line) && !line.startsWith("###");
}

/**
 * Lines belonging to the level-2 section whose heading contains `keyword`
 * (e.g. "行程總覽"), up to (not including) the next level-2 heading.
 * Matching by keyword rather than the exact heading string sidesteps having
 * to byte-for-byte reproduce emoji + variation-selector sequences from the
 * note in this source file.
 */
function getSection(lines: string[], keyword: string): string[] {
  const startIdx = lines.findIndex((l) => isH2(l) && l.includes(keyword));
  if (startIdx === -1) return [];
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (isH2(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx + 1, endIdx);
}

function parseBullets(sectionLines: string[]): string[] {
  return sectionLines
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}

function parseParagraph(sectionLines: string[]): string {
  return sectionLines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

// ---------------------------------------------------------------------------
// title / subtitle / flights / overview
// ---------------------------------------------------------------------------

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

/**
 * Markdown footnotes, used to keep the long 備註 prose out of the table cells
 * that carry it — a 1,200-character cell makes the whole day unreadable in
 * Obsidian. A cell holds `… [^kbo-ticket]`, the prose lives in a
 * `[^kbo-ticket]: …` definition at the bottom of the note, and Obsidian shows
 * it on hover.
 *
 * Definitions are single-line: the prose is reassembled into the cell before
 * anything else parses it, so a continuation line would have to survive a
 * split that the table parser never sees. Returns the note's lines with the
 * definitions removed so they cannot leak into a `## ` section.
 */
function extractFootnotes(lines: string[]): {
  footnotes: Map<string, string>;
  lines: string[];
} {
  const footnotes = new Map<string, string>();
  const kept: string[] = [];
  for (const line of lines) {
    const match = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line);
    if (match) footnotes.set(match[1], match[2].trim());
    else kept.push(line);
  }
  return { footnotes, lines: kept };
}

/**
 * Pull `[^label]` references out of `text` instead of expanding them in
 * place, returning the prose separately.
 *
 * Expanding inline is what the parser used to do, and it read badly: the
 * cell's one-line summary ran straight into a 1,200-character definition with
 * no seam, so the card was a wall of text and the summary — the part written
 * to be skimmed — was invisible. Keeping them apart lets the card lead with
 * the summary and show the prose as its own block.
 *
 * An undefined label is left in the text: a visible marker beats silently
 * dropping the prose. Removing a marker can leave a double space behind, so
 * runs of spaces collapse — but not newlines, which a `<br>` in the cell
 * turned into real line breaks that the card still honours.
 */
function splitFootnotes(
  text: string,
  footnotes: Map<string, string>,
): { text: string; detail: string[] } {
  const detail: string[] = [];
  const stripped = text.replace(/\[\^([^\]]+)\]/g, (marker, label: string) => {
    const prose = footnotes.get(label);
    if (prose === undefined) return marker;
    detail.push(prose);
    return "";
  });
  return { text: stripped.replace(/[ \t]{2,}/g, " ").trim(), detail };
}

function parseTitleAndSubtitle(lines: string[]): { title: string; subtitle: string } {
  const titleIdx = lines.findIndex((l) => /^#\s+/.test(l));
  if (titleIdx === -1) return { title: "", subtitle: "" };
  const title = lines[titleIdx].replace(/^#\s+/, "").trim();

  const parts: string[] = [];
  let collecting = false;
  for (let i = titleIdx + 1; i < lines.length; i++) {
    if (isH2(lines[i])) break;
    const t = lines[i].trim();
    if (!t) {
      if (collecting) break;
      continue;
    }
    collecting = true;
    parts.push(t);
  }
  return { title, subtitle: parts.join(" ").trim() };
}

function parseFlights(lines: string[]): Flight[] {
  const rows = extractTableRows(getSection(lines, "班機資訊"));
  return rows.map((cells) => ({
    seg: cells[0] ?? "",
    date: cells[1] ?? "",
    dep: cells[2] ?? "",
    arr: cells[3] ?? "",
    flightNo: cells[4] ?? "",
  }));
}

function parseOverviewRows(lines: string[]): OverviewRow[] {
  const rows = extractTableRows(getSection(lines, "行程總覽"));
  return rows.map((cells) => ({
    date: cells[0] ?? "",
    city: cells[1] ?? "",
    theme: cells[2] ?? "",
  }));
}

// ---------------------------------------------------------------------------
// per-day parsing
// ---------------------------------------------------------------------------

/**
 * "### Day 1 · 2026-08-30（日）· 首爾 — 深夜抵達仁川、進市區入住" →
 * { date: "2026-08-30", city: "首爾", theme: "深夜抵達仁川、進市區入住" }
 *
 * The theme itself may contain `·` or `—`, so we deliberately split on the
 * *first* `·` (day number), then the *first* `·` of what remains (date), then
 * the *first* `—` of what remains (city vs. theme) — never a blanket split.
 */
function parseDayHeading(line: string): { date: string; city: string; theme: string } | null {
  const m = line.match(/^###\s+Day\s+\d+\s*(.*)$/);
  if (!m) return null;
  const rest = m[1];

  const firstDot = rest.indexOf("·");
  if (firstDot === -1) return null;
  const afterFirstDot = rest.slice(firstDot + 1);

  const secondDot = afterFirstDot.indexOf("·");
  if (secondDot === -1) return null;
  const dateChunk = afterFirstDot.slice(0, secondDot);
  const afterSecondDot = afterFirstDot.slice(secondDot + 1);

  const dashIdx = afterSecondDot.indexOf("—");
  if (dashIdx === -1) return null;
  const city = afterSecondDot.slice(0, dashIdx).trim();
  const theme = afterSecondDot.slice(dashIdx + 1).trim();

  const dateMatch = dateChunk.match(/\d{4}-\d{2}-\d{2}/);
  return { date: dateMatch ? dateMatch[0] : "", city, theme };
}

/**
 * "名稱 @緯度,經度" → { name, lat, lng }; "名稱" (no `@`) → { name };
 * empty cell → null. Splits on the LAST `@` since the place name itself
 * could in principle contain one.
 */
function parsePlace(cell: string): Place | null {
  const trimmed = cell.trim();
  if (!trimmed) return null;

  const atIdx = trimmed.lastIndexOf("@");
  if (atIdx === -1) return { name: trimmed };

  const name = trimmed.slice(0, atIdx).trim();
  const coordsPart = trimmed.slice(atIdx + 1).trim();
  const coordsMatch = coordsPart.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!coordsMatch) return name ? { name } : null;

  return { name, lat: Number(coordsMatch[1]), lng: Number(coordsMatch[2]) };
}

interface ParsedNotes {
  booking?: string;
  notes: string;
  detail?: string;
  links: ScheduleLink[];
}

const BOOKING_PREFIX = "訂位：";

/**
 * A 備註 cell can be: a `訂位：` prefix up to the first full-width `｜`
 * (→ booking), then arbitrary text that may contain `[label](url)` markdown
 * links (→ links[], with the link syntax replaced by its label in-place),
 * with whatever remains → notes. Any further `｜` inside that remaining text
 * is left alone — it's just part of the sentence.
 *
 * `[^label]` footnote references are pulled out after the `｜` split (so prose
 * pulled in from a definition can contain `｜` freely) and before the link
 * scan (so links written inside a definition still reach `links[]`). The prose
 * lands in `detail`, not `notes` — see `splitFootnotes`.
 */
function parseNotesCell(raw: string, footnotes: Map<string, string>): ParsedNotes {
  let text = raw;
  let booking: string | undefined;

  if (text.startsWith(BOOKING_PREFIX)) {
    const rest = text.slice(BOOKING_PREFIX.length);
    const sepIdx = rest.indexOf("｜");
    if (sepIdx === -1) {
      booking = rest.trim();
      text = "";
    } else {
      booking = rest.slice(0, sepIdx).trim();
      text = rest.slice(sepIdx + 1);
    }
  }

  // A footnote referenced from the 訂位： half belongs in the same detail
  // block as one referenced from the note text — both are the long-form
  // version of this row, and the card shows them together.
  const detailParts: string[] = [];
  if (booking) {
    const split = splitFootnotes(booking, footnotes);
    booking = split.text;
    detailParts.push(...split.detail);
  }
  const splitText = splitFootnotes(text, footnotes);
  text = splitText.text;
  detailParts.push(...splitText.detail);

  const links: ScheduleLink[] = [];
  const collectLinks = (s: string) =>
    s.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_match, label: string, url: string) => {
      links.push({ label, url });
      return label;
    });

  const notes = collectLinks(text).trim();
  const detail = detailParts.map(collectLinks).join("\n\n").trim();

  return { booking, notes, detail: detail || undefined, links };
}

function parseDayItemRow(cells: string[], footnotes: Map<string, string>): DayItem {
  const [
    doneCell = "",
    time = "",
    actualTime = "",
    type = "",
    title = "",
    placeCell = "",
    cost = "",
    notesCell = "",
    log = "",
  ] = cells;

  const { booking, notes, detail, links } = parseNotesCell(notesCell, footnotes);

  return {
    title,
    time,
    actualTime: actualTime || undefined,
    type: type as CategoryKey,
    place: parsePlace(placeCell),
    notes,
    detail,
    cost: cost || undefined,
    booking: booking || undefined,
    links,
    done: doneCell !== "" && doneCell !== "-",
    log: log || undefined,
  };
}

function parseDayBlocks(lines: string[], footnotes: Map<string, string>): TripDay[] {
  const section = getSection(lines, "每日行程");
  const dayStartIdxs: number[] = [];
  section.forEach((l, i) => {
    if (/^###\s+Day\s+\d+/.test(l)) dayStartIdxs.push(i);
  });

  return dayStartIdxs.map((startIdx, i) => {
    const endIdx = i + 1 < dayStartIdxs.length ? dayStartIdxs[i + 1] : section.length;
    const blockLines = section.slice(startIdx, endIdx);
    const heading = parseDayHeading(blockLines[0]);
    const items = extractTableRows(blockLines.slice(1)).map((cells) =>
      parseDayItemRow(cells, footnotes),
    );

    return {
      date: heading?.date ?? "",
      city: heading?.city ?? "",
      theme: heading?.theme ?? "",
      items,
    };
  });
}

function parsePracticalFromMain(lines: string[]): Omit<Practical, "避雷清單"> {
  return {
    住宿: parseBullets(getSection(lines, "住宿")),
    交通: parseBullets(getSection(lines, "交通")),
    天氣: parseParagraph(getSection(lines, "天氣")),
    app: parseParagraph(getSection(lines, "實用")),
  };
}

function parseBudget(lines: string[]): string {
  return parseParagraph(getSection(lines, "預算估算"));
}

/** Parse the full itinerary note (the file containing "## 每日行程"). */
export function parseTripMarkdown(raw: string): ParsedTripMarkdown {
  const { footnotes, lines } = extractFootnotes(stripFrontmatter(raw).split("\n"));

  const { title, subtitle } = parseTitleAndSubtitle(lines);
  const flights = parseFlights(lines);
  const budget = parseBudget(lines);
  const days = parseDayBlocks(lines, footnotes);
  const overview = parseOverviewRows(lines);
  const practical = parsePracticalFromMain(lines);

  return {
    trip: { title, subtitle, budget, flights },
    days,
    practical,
    overview,
  };
}

/**
 * Parse the avoid-list note: every ordered-list item (`1. `, `2. `, …across
 * however many renumbered sections the note has), bold markers stripped.
 */
export function parseAvoidList(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) => l.match(/^\d+\.\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].replace(/\*\*/g, "").trim());
}

/**
 * Compare the "## 🗓️ 行程總覽" summary table against the per-day
 * `### Day N` headings and report every mismatch found — a pure function so
 * it can be exercised with synthetic data in tests. Never throws and never
 * rewrites anything; it only reports.
 */
export function findOverviewMismatches(overview: OverviewRow[], days: TripDay[]): string[] {
  const mismatches: string[] = [];
  const len = Math.max(overview.length, days.length);

  for (let i = 0; i < len; i++) {
    const o = overview[i];
    const d = days[i];
    const label = `Day ${i + 1}`;

    if (!o) {
      mismatches.push(`${label}：總覽表缺少對應列（每日行程為 ${d.date} ${d.city}）`);
      continue;
    }
    if (!d) {
      mismatches.push(`${label}：每日行程缺少對應天數（總覽表為 ${o.date} ${o.city}）`);
      continue;
    }
    if (o.date !== d.date) {
      mismatches.push(`${label} 日期不一致：總覽=${o.date}，每日行程=${d.date}`);
    }
    if (o.city !== d.city) {
      mismatches.push(`${label} 城市不一致：總覽=${o.city}，每日行程=${d.city}`);
    }
    if (o.theme !== d.theme) {
      mismatches.push(`${label} 主題不一致：總覽=${o.theme}，每日行程=${d.theme}`);
    }
  }

  return mismatches;
}

// ---------------------------------------------------------------------------
// module-level load — glob the two notes, identify by content, parse
// ---------------------------------------------------------------------------

const rawFiles = import.meta.glob("../content/trip/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const fileContents = Object.values(rawFiles);
const mainRaw = fileContents.find((c) => c.includes("## 每日行程"));
const avoidRaw = fileContents.find((c) => c !== mainRaw);

if (!mainRaw) {
  throw new Error(
    "tripSchedule: no file in src/content/trip/*.md contains a \"## 每日行程\" heading",
  );
}

const parsedMain = parseTripMarkdown(mainRaw);
const avoidList = avoidRaw ? parseAvoidList(avoidRaw) : [];

export const TRIP: Trip = parsedMain.trip;
export const TRIP_DAYS: TripDay[] = parsedMain.days;
export const PRACTICAL: Practical = {
  ...parsedMain.practical,
  避雷清單: avoidList,
};

/** Report inconsistencies between the loaded note's overview table and its
 * per-day headings. Returns an empty array when everything lines up. */
export function checkOverviewConsistency(): string[] {
  return findOverviewMismatches(parsedMain.overview, TRIP_DAYS);
}

/** Category → accent colour. Drives timeline dots, tags and filter pills. */
export const CATS: Record<CategoryKey, { color: string }> = {
  交通: { color: "#6ea8fe" },
  住宿: { color: "#b89bd6" },
  美食: { color: "#e08a6a" },
  景點: { color: "#e0b36a" },
  購物: { color: "#63c7b2" },
};

/** Preferred order of the filter pills (only categories present in a day show). */
export const FILTER_ORDER: CategoryKey[] = ["交通", "景點", "美食", "購物", "住宿"];

// ---- map links (built from the note's 地點 GPS coords) ----

/** True when a place has real `@lat,lng` coordinates from the note (as
 * opposed to a hand-added place with a name only). */
function hasCoords(p: Place): p is Place & { lat: number; lng: number } {
  return typeof p.lat === "number" && typeof p.lng === "number";
}

/**
 * Naver Maps app deep-link. With coordinates, drops the exact pin (ideal on
 * phones — the primary use). Without coordinates — a place the note only gave
 * a name for — falls back to a name search deep-link so the row still gets a
 * working link. Offered as a secondary button on touch devices only: it
 * silently does nothing when the app is not installed, so `naverWebUrl()` is
 * always the primary link.
 */
export function naverAppUrl(p: Place): string {
  if (hasCoords(p)) {
    const q = new URLSearchParams({
      lat: String(p.lat),
      lng: String(p.lng),
      name: p.name,
      appname: "seanachan.github.io",
    });
    return `nmap://place?${q.toString()}`;
  }
  const q = new URLSearchParams({
    query: p.name,
    appname: "seanachan.github.io",
  });
  return `nmap://search?${q.toString()}`;
}

/**
 * Naver Maps on the web — the primary link, in any browser. Everything points
 * at Naver, never Google: South Korea does not permit map data export, so
 * Google Maps has no driving navigation there and patchy walking directions.
 * The note's own avoid-list says as much ("Google Map 在釜山很容易帶錯路").
 *
 * Three query shapes, the first two verified against map.naver.com
 * (2026-07-25):
 *   - a Korean place name → the POI page, the best match Naver can make
 *   - "lat,lng"           → the coordinate page, which also prints the Korean
 *                           road address. That address is the thing to show a
 *                           taxi driver, since the note carries Chinese ones.
 *   - a bare place name   → a plain search, for rows the note gave no coords
 */
export function naverWebUrl(p: Place, koreanName?: string | null): string {
  const query = koreanName?.trim()
    ? koreanName.trim()
    : hasCoords(p)
      ? `${p.lat},${p.lng}`
      : p.name;
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

const HANGUL_IN_BRACKETS = /[（(]([^）)]*[가-힣][^）)]*)[）)]/;

/**
 * The Korean name for a place, when the note happens to mention one in
 * brackets — "聖水洞（성수동）" → "성수동". Most rows have none, so callers
 * must handle null; nothing here invents a name.
 */
export function koreanNameOf(item: { title: string; notes?: string | null }): string | null {
  const match = HANGUL_IN_BRACKETS.exec(item.title) ?? HANGUL_IN_BRACKETS.exec(item.notes ?? "");
  return match ? match[1].trim() : null;
}

// ---- day-label helpers ----

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** "2026-08-30" → "8/30". */
export function mdLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** "2026-08-30" → "週六". */
export function weekdayLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return "週" + WEEKDAYS[d.getDay()];
}

// ---------------------------------------------------------------------------
// Where the traveller is in the trip. All of these read the *local* calendar
// date deliberately: a phone in Seoul is on Korea time, so "today" is whatever
// the device says it is, not a fixed timezone conversion.
// ---------------------------------------------------------------------------

/**
 * The instant an item is due, from its day's date and its local `HH:MM`.
 * Returns null when the row has no usable time, so callers can leave such an
 * item out of "what's next" rather than treating it as 1970.
 */
export function itemInstant(date: string, time: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const at = new Date(`${date}T00:00:00`);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Index of the day being travelled, or -1 when `now` falls outside the trip. */
export function todayIndex(now: Date, days: TripDay[] = TRIP_DAYS): number {
  const today = isoDate(now);
  return days.findIndex((d) => d.date === today);
}

/**
 * Which day to open on: today while travelling, day 1 before departure, and
 * the last day afterwards — never a day nobody is looking for.
 */
export function initialDayIndex(now: Date, days: TripDay[] = TRIP_DAYS): number {
  const i = todayIndex(now, days);
  if (i >= 0) return i;
  return isoDate(now) > days[days.length - 1].date ? days.length - 1 : 0;
}

/** Whole days until departure; 0 once the trip has started. */
export function daysUntilTrip(now: Date, days: TripDay[] = TRIP_DAYS): number {
  const start = new Date(days[0].date + "T00:00:00");
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((start.getTime() - midnight.getTime()) / 86_400_000));
}

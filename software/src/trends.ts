// Pure trend helpers: unicode sparklines, daily aggregation, week-over-week
// deltas, and light-on-hours accounting. No I/O — state.ts supplies the raw
// series, these functions shape it. All unit-tested.

const BARS = "▁▂▃▄▅▆▇█";
const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Unicode sparkline scaled across the series' own min..max. Empty -> "".
// A flat series renders as mid-height bars (steady, not zero).
export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const mid = BARS[BARS.length >> 1] ?? "▅";
  return values
    .map((v) => {
      if (span === 0) return mid;
      const idx = Math.round(((v - min) / span) * (BARS.length - 1));
      return BARS[Math.max(0, Math.min(BARS.length - 1, idx))] ?? "▁";
    })
    .join("");
}

export type Reducer = "sum" | "avg";

// Bucket timestamped values into one number per day for the last `days` days,
// oldest first. Empty days are 0. "avg" averages only the samples present that
// day (a day with no samples stays 0).
export function dailyBuckets(
  items: { ts: string; value: number }[],
  days: number,
  reducer: Reducer,
  now: Date = new Date(),
): number[] {
  const buckets = new Array<number>(days).fill(0);
  const counts = new Array<number>(days).fill(0);
  const todayStart = startOfDay(now);
  for (const it of items) {
    const dayStart = startOfDay(new Date(it.ts));
    const idx = days - 1 - Math.round((todayStart - dayStart) / DAY_MS);
    if (idx < 0 || idx >= days) continue;
    buckets[idx] = (buckets[idx] ?? 0) + it.value;
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  if (reducer === "avg") {
    for (let i = 0; i < days; i++) {
      const c = counts[i] ?? 0;
      if (c > 0) buckets[i] = (buckets[i] ?? 0) / c;
    }
  }
  return buckets;
}

export interface WeekDelta {
  thisWeek: number;
  lastWeek: number;
  delta: number; // thisWeek - lastWeek
  pct: number | null; // null when lastWeek is 0
}

const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

// Compare the last 7 days against the 7 before them, over the raw series (so an
// "avg" reducer averages only real samples, not empty days). "sum" for totals
// (water ml), "avg" for rates (health score).
export function weekOverWeek(
  items: { ts: string; value: number }[],
  agg: Reducer,
  now: Date = new Date(),
): WeekDelta {
  const end = startOfDay(now) + DAY_MS; // end of today
  const weekMs = 7 * DAY_MS;
  const thisStart = end - weekMs;
  const lastStart = end - 2 * weekMs;
  const thisVals: number[] = [];
  const lastVals: number[] = [];
  for (const it of items) {
    const t = new Date(it.ts).getTime();
    if (t >= thisStart && t < end) thisVals.push(it.value);
    else if (t >= lastStart && t < thisStart) lastVals.push(it.value);
  }
  const reduce = (a: number[]) => (a.length === 0 ? 0 : agg === "sum" ? sum(a) : sum(a) / a.length);
  const thisWeek = reduce(thisVals);
  const lastWeek = reduce(lastVals);
  const delta = thisWeek - lastWeek;
  return { thisWeek, lastWeek, delta, pct: lastWeek === 0 ? null : (delta / lastWeek) * 100 };
}

// Human phrasing of a week-over-week change, e.g. "health up 1.2 (+18%) vs last week".
export function describeDelta(
  label: string,
  d: WeekDelta,
  opts: { unit?: string; digits?: number } = {},
): string {
  const digits = opts.digits ?? 1;
  const unit = opts.unit ?? "";
  if (Math.abs(d.delta) < Math.pow(10, -digits) / 2) return `${label} flat vs last week`;
  const dir = d.delta > 0 ? "up" : "down";
  const mag = Math.abs(d.delta).toFixed(digits);
  const pct = d.pct === null ? "" : ` (${d.delta > 0 ? "+" : "−"}${Math.abs(d.pct).toFixed(0)}%)`;
  return `${label} ${dir} ${mag}${unit}${pct} vs last week`;
}

// Total hours the light was ON per day for the last `days` days (oldest first),
// derived from on/off transition events, assuming state persists between events
// and is off before the first one.
export function lightOnHoursByDay(
  events: { ts: string; on: boolean }[],
  days: number,
  now: Date = new Date(),
): number[] {
  const out = new Array<number>(days).fill(0);
  const dayStart0 = startOfDay(now) - (days - 1) * DAY_MS;
  const windowEnd = now.getTime();
  const sorted = events
    .map((e) => ({ t: new Date(e.ts).getTime(), on: e.on }))
    .sort((a, b) => a.t - b.t);

  let state = false;
  for (const e of sorted) if (e.t <= dayStart0) state = e.on;

  let cursor = dayStart0;
  for (const e of sorted) {
    if (e.t <= dayStart0) continue;
    if (e.t > windowEnd) break;
    if (state) distribute(out, dayStart0, days, cursor, e.t);
    state = e.on;
    cursor = e.t;
  }
  if (state) distribute(out, dayStart0, days, cursor, windowEnd);
  return out;
}

function distribute(out: number[], dayStart0: number, days: number, from: number, to: number): void {
  let a = Math.max(from, dayStart0);
  const end = Math.min(to, dayStart0 + days * DAY_MS);
  while (a < end) {
    const idx = Math.floor((a - dayStart0) / DAY_MS);
    const dayEnd = dayStart0 + (idx + 1) * DAY_MS;
    const b = Math.min(end, dayEnd);
    if (idx >= 0 && idx < days) out[idx] = (out[idx] ?? 0) + (b - a) / 3_600_000;
    a = b;
  }
}

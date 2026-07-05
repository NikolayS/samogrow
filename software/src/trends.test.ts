import { expect, test, describe } from "bun:test";
import { sparkline, dailyBuckets, weekOverWeek, describeDelta, lightOnHoursByDay } from "./trends.ts";

describe("sparkline", () => {
  test("empty input is empty string", () => {
    expect(sparkline([])).toBe("");
  });

  test("a rising ramp uses the full bar range", () => {
    expect(sparkline([0, 1, 2, 3, 4, 5, 6, 7])).toBe("▁▂▃▄▅▆▇█");
  });

  test("min renders lowest and max renders highest", () => {
    const s = sparkline([3, 9, 3, 9]);
    expect(s[0]).toBe("▁");
    expect(s[1]).toBe("█");
  });

  test("a flat series renders steady mid bars, not empty", () => {
    expect(sparkline([4, 4, 4])).toBe("▅▅▅");
  });
});

describe("dailyBuckets", () => {
  const now = new Date(2026, 5, 15, 12, 0, 0); // June 15, local
  const at = (day: number, hour: number) => new Date(2026, 5, day, hour, 0, 0).toISOString();

  test("sums values into per-day buckets, oldest first", () => {
    const items = [
      { ts: at(13, 9), value: 2 },
      { ts: at(13, 20), value: 4 },
      { ts: at(15, 8), value: 10 },
    ];
    expect(dailyBuckets(items, 3, "sum", now)).toEqual([6, 0, 10]);
  });

  test("averages only the samples present that day", () => {
    const items = [
      { ts: at(13, 9), value: 2 },
      { ts: at(13, 20), value: 4 },
      { ts: at(15, 8), value: 10 },
    ];
    expect(dailyBuckets(items, 3, "avg", now)).toEqual([3, 0, 10]);
  });

  test("ignores items outside the window", () => {
    expect(dailyBuckets([{ ts: at(1, 9), value: 99 }], 3, "sum", now)).toEqual([0, 0, 0]);
  });
});

describe("weekOverWeek", () => {
  const now = new Date(2026, 5, 15, 12, 0, 0);
  const at = (day: number) => new Date(2026, 5, day, 12, 0, 0).toISOString();
  const items = [
    { ts: at(14), value: 8 }, // this week
    { ts: at(10), value: 6 }, // this week
    { ts: at(5), value: 2 }, // last week
    { ts: at(3), value: 4 }, // last week
  ];

  test("sum splits the two 7-day windows", () => {
    const d = weekOverWeek(items, "sum", now);
    expect(d.thisWeek).toBe(14);
    expect(d.lastWeek).toBe(6);
    expect(d.delta).toBe(8);
    expect(Math.round(d.pct!)).toBe(133);
  });

  test("avg reduces only real samples", () => {
    const d = weekOverWeek(items, "avg", now);
    expect(d.thisWeek).toBe(7);
    expect(d.lastWeek).toBe(3);
  });

  test("null pct when last week had no data", () => {
    const d = weekOverWeek([{ ts: at(14), value: 5 }], "sum", now);
    expect(d.lastWeek).toBe(0);
    expect(d.pct).toBeNull();
  });
});

describe("describeDelta", () => {
  test("phrases an increase with percent", () => {
    const s = describeDelta("health", { thisWeek: 8, lastWeek: 6, delta: 2, pct: 33.3 });
    expect(s).toContain("health up 2.0");
    expect(s).toContain("+33%");
  });

  test("phrases a flat change", () => {
    expect(describeDelta("water", { thisWeek: 5, lastWeek: 5, delta: 0, pct: 0 })).toBe("water flat vs last week");
  });

  test("omits percent when last week was zero", () => {
    const s = describeDelta("water", { thisWeek: 10, lastWeek: 0, delta: 10, pct: null }, { unit: "ml", digits: 0 });
    expect(s).toBe("water up 10ml vs last week");
  });
});

describe("lightOnHoursByDay", () => {
  const now = new Date(2026, 5, 15, 12, 0, 0);
  const at = (day: number, hour: number) => new Date(2026, 5, day, hour, 0, 0).toISOString();

  test("sums an on/off span within a day", () => {
    const events = [
      { ts: at(15, 6), on: true },
      { ts: at(15, 9), on: false },
    ];
    expect(lightOnHoursByDay(events, 1, now)[0]).toBeCloseTo(3, 6);
  });

  test("an open (still-on) span runs to now", () => {
    const events = [{ ts: at(15, 10), on: true }];
    expect(lightOnHoursByDay(events, 1, now)[0]).toBeCloseTo(2, 6);
  });

  test("light off before the window is zero hours", () => {
    const events = [{ ts: at(14, 6), on: false }];
    expect(lightOnHoursByDay(events, 1, now)[0]).toBe(0);
  });
});

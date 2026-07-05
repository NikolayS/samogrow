import { expect, test, describe, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { Db, DEFAULT_UNIT } from "./state.ts";
import { Brain } from "./brain.ts";
import { Pump, MockSwitch } from "./hardware.ts";
import { Controller, type CycleSummaryPayload, type WaterReminderPayload } from "./controller.ts";
import type { Hardware } from "./hardware.ts";
import type { Verdict } from "./brain.ts";

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    healthScore: 7,
    summary: "ok",
    issues: [],
    plants: [],
    reservoirLevel: "ok",
    waterTopUpMl: 0,
    lightAdjustment: "none",
    alert: false,
    ...over,
  };
}

describe("per-unit analysis storage + trend separation (Db)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "samogrow-unit-db-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  function freshDb(): Db {
    const cfgPath = join(scratch, `cfg-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(cfgPath, JSON.stringify({ dataDir: join(scratch, Math.random().toString(36).slice(2)) }));
    process.env.SAMOGROW_MOCK = "1";
    return new Db(loadConfig(cfgPath));
  }

  test("health series separate by unit, with an 'all' rollup", () => {
    const db = freshDb();
    db.saveAnalysis({ unit: "diy", photoPaths: ["a"], model: "m", verdict: verdict({ healthScore: 8 }), raw: "{}" });
    db.saveAnalysis({ unit: "auk", photoPaths: ["b"], model: "m", verdict: verdict({ healthScore: 4 }), raw: "{}" });
    db.saveAnalysis({ unit: "diy", photoPaths: ["c"], model: "m", verdict: verdict({ healthScore: 9 }), raw: "{}" });

    expect(db.healthSeries(1, "diy").map((s) => s.score)).toEqual([8, 9]);
    expect(db.healthSeries(1, "auk").map((s) => s.score)).toEqual([4]);
    // No filter (and the explicit "all") both roll up every unit chronologically.
    expect(db.healthSeries(1).map((s) => s.score)).toEqual([8, 4, 9]);
    expect(db.healthSeries(1, "all").map((s) => s.score)).toEqual([8, 4, 9]);
  });

  test("unitLabels + latestPerUnit report each unit's newest verdict", () => {
    const db = freshDb();
    db.saveAnalysis({ unit: "diy", photoPaths: ["a"], model: "m", verdict: verdict({ healthScore: 8 }), raw: "{}" });
    db.saveAnalysis({ unit: "auk", photoPaths: ["b"], model: "m", verdict: verdict({ healthScore: 4 }), raw: "{}" });
    db.saveAnalysis({ unit: "diy", photoPaths: ["c"], model: "m", verdict: verdict({ healthScore: 9 }), raw: "{}" });

    expect(db.unitLabels(1)).toEqual(["diy", "auk"]); // first-seen order
    const latest = db.latestPerUnit();
    expect(latest.map((r) => r.unit)).toEqual(["diy", "auk"]); // newest analysis first
    expect(latest.find((r) => r.unit === "diy")!.verdict.healthScore).toBe(9);
    expect(latest.find((r) => r.unit === "auk")!.verdict.healthScore).toBe(4);
  });

  test("an untagged analysis defaults to the single-unit label", () => {
    const db = freshDb();
    db.saveAnalysis({ photoPaths: ["a"], model: "m", verdict: verdict(), raw: "{}" });
    expect(db.lastAnalysis()!.unit).toBe(DEFAULT_UNIT);
    expect(db.unitLabels(1)).toEqual([DEFAULT_UNIT]);
  });
});

describe("pump acts only for its own unit (Controller)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "samogrow-unit-pump-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  // Two-unit garden, pump plumbed to "diy". A shared MockSwitch/Pump lets us see
  // whether the pump actually ran.
  function setup(pumpUnit: string) {
    const cfgPath = join(scratch, `cfg-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(
      cfgPath,
      JSON.stringify({
        dataDir: join(scratch, Math.random().toString(36).slice(2)),
        pump: { plugHost: "1.2.3.4", unit: pumpUnit },
        cameras: { devices: [{ url: "rtsp://cam/diy", label: "diy" }, { url: "rtsp://cam/auk", label: "auk" }] },
      }),
    );
    process.env.SAMOGROW_MOCK = "1";
    const cfg = loadConfig(cfgPath);
    (cfg as { anthropicApiKey: string }).anthropicApiKey = "test-key";
    const sw = new MockSwitch("pump");
    sw.watts = 5; // healthy, no lockout
    const pump = new Pump(sw, 30, 180, 15);
    const hw = { light: new MockSwitch("light"), pump } as unknown as Hardware;
    const db = new Db(cfg);
    const brain = new Brain(cfg);
    const controller = new Controller(cfg, hw, db, brain, { maxSecondsPerRun: 30, maxSecondsPerDay: 180 }, {});
    const summaries: CycleSummaryPayload[] = [];
    const reminders: WaterReminderPayload[] = [];
    controller.setCallbacks({
      onCycleSummary: (p) => summaries.push(p),
      onWaterReminder: (p) => reminders.push(p),
    });
    // Every unit wants a 30 ml top-up (2 s pump run — long enough to sample).
    (brain as unknown as { analyze: unknown }).analyze = async () => ({
      verdict: verdict({ waterTopUpMl: 30 }),
      raw: "{}",
    });
    return { cfg, pump, db, controller, summaries, reminders };
  }

  test("pumps for the mapped unit and reminds for the other; both stored per-unit", async () => {
    const { pump, db, controller, summaries, reminders } = setup("diy");
    const analyses = await controller.runAnalysis();

    // Two units analysed, each its own stored verdict.
    expect(analyses.map((a) => a.label).sort()).toEqual(["auk", "diy"]);
    expect(db.unitLabels(1).sort()).toEqual(["auk", "diy"]);

    // The pump ran exactly once — for "diy" only.
    expect(pump.budgetUsedSeconds).toBeGreaterThan(0);
    const waterEvents = db.recentEvents(50).filter((e) => e.kind === "water");
    expect(waterEvents).toHaveLength(1);
    expect((waterEvents[0]!.detail as { unit: string; source: string })).toMatchObject({ unit: "diy", source: "brain" });

    // "auk" (non-pump unit) got a manual-top-up reminder instead.
    const reminderEvents = db.recentEvents(50).filter((e) => e.kind === "waterReminder");
    expect(reminderEvents.map((e) => (e.detail as { unit: string }).unit)).toEqual(["auk"]);

    // Multi-unit gardens deliver ONE combined summary, not per-unit reminders.
    expect(reminders).toHaveLength(0);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.units.map((u) => u.label).sort()).toEqual(["auk", "diy"]);
    expect(summaries[0]!.reminders.map((r) => r.label)).toEqual(["auk"]);
  }, 8000);

  test("mapping the pump to the other unit flips which one pumps", async () => {
    const { pump, db, controller } = setup("auk");
    await controller.runAnalysis();
    expect(pump.budgetUsedSeconds).toBeGreaterThan(0);
    const waterEvents = db.recentEvents(50).filter((e) => e.kind === "water");
    expect(waterEvents).toHaveLength(1);
    expect((waterEvents[0]!.detail as { unit: string }).unit).toBe("auk");
    const reminderEvents = db.recentEvents(50).filter((e) => e.kind === "waterReminder");
    expect(reminderEvents.map((e) => (e.detail as { unit: string }).unit)).toEqual(["diy"]);
  }, 8000);
});

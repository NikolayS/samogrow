import { expect, test, describe, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { Hardware } from "./hardware.ts";
import { Db } from "./state.ts";
import { Brain } from "./brain.ts";
import { Controller, formatWaterReminder, type WaterReminderPayload } from "./controller.ts";
import type { Verdict } from "./brain.ts";

// Minimal healthy verdict, overridable per test.
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

describe("formatWaterReminder", () => {
  test("quotes ml and cups for small amounts", () => {
    const s = formatWaterReminder(240);
    expect(s).toContain("240 ml");
    expect(s).toContain("cups");
  });
  test("quotes liters at/above 1 L", () => {
    expect(formatWaterReminder(1500)).toContain("1.5 liters");
  });
  test("falls back to a generic top-up when ml is 0", () => {
    expect(formatWaterReminder(0)).toBe("🪣 Time to water: top up the reservoir");
  });
});

describe("Hardware manual mode (no pump.plugHost)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "samogrow-manual-hw-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  function cfgWith(pump: Record<string, unknown>) {
    const p = join(scratch, `cfg-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, JSON.stringify({ dataDir: join(scratch, Math.random().toString(36).slice(2)), pump }));
    process.env.SAMOGROW_MOCK = "1";
    return loadConfig(p);
  }

  test("builds no pump and flags manual when plugHost is empty", () => {
    const hw = new Hardware(cfgWith({ plugHost: "" }));
    expect(hw.isManual).toBe(true);
    expect(hw.pump).toBeNull();
  });

  test("builds a pump (auto mode) when plugHost is set", () => {
    const hw = new Hardware(cfgWith({ plugHost: "192.168.1.41" }));
    expect(hw.isManual).toBe(false);
    expect(hw.pump).not.toBeNull();
  });
});

describe("Controller manual watering path", () => {
  const scratch = mkdtempSync(join(tmpdir(), "samogrow-manual-ctrl-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  function setup() {
    const cfgPath = join(scratch, `cfg-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(cfgPath, JSON.stringify({ dataDir: join(scratch, Math.random().toString(36).slice(2)), pump: { plugHost: "" } }));
    process.env.SAMOGROW_MOCK = "1";
    const cfg = loadConfig(cfgPath);
    (cfg as { anthropicApiKey: string }).anthropicApiKey = "test-key";
    const hw = new Hardware(cfg);
    const db = new Db(cfg);
    const brain = new Brain(cfg);
    const controller = new Controller(cfg, hw, db, brain);
    const reminders: WaterReminderPayload[] = [];
    controller.setCallbacks({ onWaterReminder: (p) => reminders.push(p) });
    return { cfg, hw, db, brain, controller, reminders };
  }

  // Drive the analysis water branch directly with a stubbed brain verdict, so we
  // never touch cameras or the network.
  async function analyzeWith(controller: Controller, brain: Brain, v: Verdict) {
    (brain as unknown as { analyze: unknown }).analyze = async () => ({ verdict: v, raw: "{}" });
    // captureAll writes placeholder JPEGs in SAMOGROW_MOCK mode, so analysis runs.
    return controller.runAnalysis();
  }

  test("hardware is manual and no pump exists", () => {
    const { hw, controller } = setup();
    expect(hw.pump).toBeNull();
    expect(controller.isManual).toBe(true);
  });

  test("a water-wanting verdict emits a reminder and logs no pump run", async () => {
    const { controller, brain, db, reminders } = setup() as any;
    await analyzeWith(controller, brain, verdict({ waterTopUpMl: 150 }));
    expect(reminders).toHaveLength(1);
    expect(reminders[0].ml).toBe(150);
    expect(reminders[0].text).toContain("150 ml");
    // No pump run / water event logged (only the reminder).
    expect(db.recentEvents(20).some((e: { kind: string }) => e.kind === "pumpRun")).toBe(false);
    expect(db.waterSeries(1)).toHaveLength(0);
    expect(controller.manualWaterRecommendation()).toBe(150);
  });

  test("a low reservoir with zero top-up still reminds", async () => {
    const { controller, brain, reminders } = setup() as any;
    await analyzeWith(controller, brain, verdict({ waterTopUpMl: 0, reservoirLevel: "low" }));
    expect(reminders).toHaveLength(1);
    expect(reminders[0].ml).toBe(0);
  });

  test("acknowledging logs a manual watering into the water trend and clears the outstanding reminder", async () => {
    const { controller, brain, db, reminders } = setup() as any;
    await analyzeWith(controller, brain, verdict({ waterTopUpMl: 150 }));
    const logged = controller.logManualWatering(150);
    expect(logged).toBe(150);
    const series = db.waterSeries(1);
    expect(series).toHaveLength(1);
    expect(series[0].ml).toBe(150);
    // Ack clears the pending reminder, so the next reminder is a fresh one, not
    // an escalation.
    await analyzeWith(controller, brain, verdict({ waterTopUpMl: 150 }));
    expect(reminders[reminders.length - 1].repeat).toBe(false);
  });

  test("logManualWatering(0) falls back to the outstanding recommendation", async () => {
    const { controller, brain } = setup() as any;
    await analyzeWith(controller, brain, verdict({ waterTopUpMl: 200 }));
    expect(controller.logManualWatering(0)).toBe(200);
  });

  test("waterNow in manual mode records a hand top-up instead of pumping", async () => {
    const { controller, db } = setup();
    const actual = await controller.waterNow(120);
    expect(actual).toBe(120);
    expect(db.waterSeries(1)).toHaveLength(1);
  });

  test("status reports manual mode with zeroed pump budget", () => {
    const { controller } = setup();
    const s = controller.status();
    expect(s.manual).toBe(true);
    expect(s.pumpLocked).toBe(false);
    expect(s.pumpBudgetTotalSeconds).toBe(0);
    expect(controller.statusText()).toContain("Watering: manual");
  });

  test("a repeat reminder next cycle is flagged as such", async () => {
    const { controller, brain, reminders } = setup() as any;
    await analyzeWith(controller, brain, verdict({ waterTopUpMl: 150 }));
    await analyzeWith(controller, brain, verdict({ waterTopUpMl: 150 }));
    expect(reminders).toHaveLength(2);
    expect(reminders[0].repeat).toBe(false);
    expect(reminders[1].repeat).toBe(true);
  });
});

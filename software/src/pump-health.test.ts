import { expect, test, describe, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pump, MockSwitch, emeterWatts, type Switch } from "./hardware.ts";
import { loadConfig } from "./config.ts";
import { Db } from "./state.ts";
import { Brain } from "./brain.ts";
import { Controller } from "./controller.ts";
import type { Hardware } from "./hardware.ts";

describe("emeterWatts", () => {
  test("reads power_mw (milliwatts) from newer firmware", () => {
    expect(emeterWatts({ emeter: { get_realtime: { power_mw: 4200 } } })).toBe(4.2);
  });
  test("reads power (watts) from older firmware", () => {
    expect(emeterWatts({ emeter: { get_realtime: { power: 3 } } })).toBe(3);
  });
  test("returns null when no meter data", () => {
    expect(emeterWatts({ system: {} })).toBeNull();
    expect(emeterWatts(null)).toBeNull();
  });
});

describe("Pump lockout enforcement (hardware layer)", () => {
  test("a locked pump refuses automatic runs but honours an explicit override", async () => {
    const sw = new MockSwitch("pump");
    const pump = new Pump(sw, 30, 180, 15);
    pump.lock("test");
    expect(pump.isLocked).toBe(true);
    expect(await pump.timedPumpRun(5)).toBe(0); // blocked (instant, no sleep)
    expect(await pump.timedPumpRun(0.02, true)).toBeCloseTo(0.02, 6); // override runs
  });
});

describe("pump-health lockout state machine (controller)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "samogrow-ph-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  function setup(watts: number) {
    const cfgPath = join(scratch, `cfg-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(cfgPath, JSON.stringify({ dataDir: join(scratch, Math.random().toString(36).slice(2)) }));
    process.env.SAMOGROW_MOCK = "1";
    const cfg = loadConfig(cfgPath);
    (cfg as { anthropicApiKey: string }).anthropicApiKey = "test-key";
    const sw = new MockSwitch("pump");
    sw.watts = watts;
    const pump = new Pump(sw, 30, 180, 15);
    const hw = { light: new MockSwitch("light"), pump } as unknown as Hardware;
    const db = new Db(cfg);
    const brain = new Brain(cfg);
    const controller = new Controller(cfg, hw, db, brain, { maxSecondsPerRun: 30, maxSecondsPerDay: 180 }, {});
    return { cfg, sw, pump, hw, db, controller };
  }

  test("a run below the health floor locks the pump and persists it", async () => {
    const { controller, db, pump } = setup(1); // 1W < 2W floor
    const actual = await controller.waterNow(30); // 30ml / 15 = 2s run (long enough to sample)
    expect(actual).toBeGreaterThan(0);
    expect(controller.pumpLocked()).toBe(true);
    expect(db.getPumpLock()).toMatchObject({ locked: true });
    // automatic runs are now blocked at the hardware layer
    expect(await pump.waterMl(30)).toBe(0);
  }, 8000);

  test("a healthy run does not lock", async () => {
    const { controller } = setup(5); // 5W > floor
    await controller.waterNow(30);
    expect(controller.pumpLocked()).toBe(false);
  }, 8000);

  test("a locked pump persists across a restart via restoreLockout", async () => {
    const { controller, db, cfg } = setup(1);
    await controller.waterNow(30);
    expect(db.getPumpLock()?.locked).toBe(true);
    // Fresh hardware + controller sharing the same db (simulating a restart).
    const freshPump = new Pump(new MockSwitch("pump"), 30, 180, 15);
    const freshHw = { light: new MockSwitch("light"), pump: freshPump } as unknown as Hardware;
    const c2 = new Controller(cfg, freshHw, db, new Brain(cfg), { maxSecondsPerRun: 30, maxSecondsPerDay: 180 }, {});
    expect(freshPump.isLocked).toBe(false);
    c2.restoreLockout();
    expect(freshPump.isLocked).toBe(true);
  }, 8000);

  test("enablePump clears the lockout and persists the clear", async () => {
    const { controller, db } = setup(1);
    await controller.waterNow(30);
    expect(controller.pumpLocked()).toBe(true);
    controller.enablePump();
    expect(controller.pumpLocked()).toBe(false);
    expect(db.getPumpLock()).toMatchObject({ locked: false });
  }, 8000);

  test("manual override waters while locked and the lockout stays until acknowledged", async () => {
    const { controller } = setup(1);
    await controller.waterNow(30); // locks
    expect(controller.pumpLocked()).toBe(true);
    const actual = await controller.waterNow(30, { override: true });
    expect(actual).toBeGreaterThan(0); // override dispensed
    expect(controller.pumpLocked()).toBe(true); // still locked until /pump enable
  }, 12000);
});

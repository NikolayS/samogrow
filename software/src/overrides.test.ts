import { expect, test, describe, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateOverride,
  coerceOverrideValue,
  applyOverrides,
  effectiveValue,
  loadOverrides,
  saveOverrides,
  isSettableKey,
  type BaseCaps,
} from "./overrides.ts";
import type { Config } from "./config.ts";

const base: BaseCaps = { maxSecondsPerRun: 30, maxSecondsPerDay: 180 };

// A minimal effective config touching only the fields overrides read/write.
function makeCfg(): Config {
  return {
    light: { onHour: 7, offHour: 23, plugHost: "" },
    pump: { plugHost: "", maxSecondsPerRun: 30, maxSecondsPerDay: 180, mlPerSecond: 15 },
    brain: { model: "haiku", deepModel: "sonnet", analysisIntervalMinutes: 120, dailyReportHour: 9, deepReviewDay: 0, deepReviewHour: 10, maxTokens: 1024 },
  } as unknown as Config;
}

describe("coerceOverrideValue", () => {
  test("hours must be integers in 0-23", () => {
    expect(coerceOverrideValue("light.onHour", "6")).toBe(6);
    expect(coerceOverrideValue("light.onHour", 24)).toBeNull();
    expect(coerceOverrideValue("light.onHour", 6.5)).toBeNull();
  });

  test("analysis interval must be positive, floored", () => {
    expect(coerceOverrideValue("brain.analysisIntervalMinutes", "90.9")).toBe(90);
    expect(coerceOverrideValue("brain.analysisIntervalMinutes", 0)).toBeNull();
  });

  test("model keys keep non-empty strings", () => {
    expect(coerceOverrideValue("brain.model", "claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(coerceOverrideValue("brain.model", "  ")).toBeNull();
  });
});

describe("validateOverride — cap lowering only", () => {
  test("a cap can be lowered", () => {
    expect(validateOverride("pump.maxSecondsPerRun", 20, base)).toMatchObject({ ok: true, value: 20 });
  });

  test("a cap cannot be raised above the config ceiling", () => {
    const res = validateOverride("pump.maxSecondsPerRun", 40, base);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("can only be lowered");
  });

  test("setting a cap exactly to the ceiling is allowed", () => {
    expect(validateOverride("pump.maxSecondsPerDay", 180, base).ok).toBe(true);
  });

  test("rejects keys not on the whitelist", () => {
    expect(validateOverride("pump.mlPerSecond", 1, base).ok).toBe(false);
    expect(validateOverride("telegramToken", "x", base).ok).toBe(false);
    expect(isSettableKey("pump.mlPerSecond")).toBe(false);
  });
});

describe("applyOverrides", () => {
  test("applies valid keys and clamps caps to the ceiling", () => {
    const cfg = makeCfg();
    applyOverrides(cfg, { "light.onHour": 5, "pump.maxSecondsPerRun": 40, "pump.maxSecondsPerDay": 90 }, base);
    expect(cfg.light.onHour).toBe(5); // applied
    expect(cfg.pump.maxSecondsPerRun).toBe(30); // above ceiling -> skipped, stays at base
    expect(cfg.pump.maxSecondsPerDay).toBe(90); // lowered -> applied
  });

  test("effectiveValue reflects a change", () => {
    const cfg = makeCfg();
    applyOverrides(cfg, { "brain.model": "claude-sonnet-5" }, base);
    expect(effectiveValue(cfg, "brain.model")).toBe("claude-sonnet-5");
  });
});

describe("load/save overrides", () => {
  const scratch = mkdtempSync(join(tmpdir(), "samogrow-ovr-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  test("round-trips and drops non-whitelisted keys", () => {
    saveOverrides(scratch, { "light.onHour": 6, "pump.maxSecondsPerRun": 10 });
    expect(loadOverrides(scratch)).toEqual({ "light.onHour": 6, "pump.maxSecondsPerRun": 10 });
  });

  test("missing file yields an empty map", () => {
    const empty = mkdtempSync(join(tmpdir(), "samogrow-ovr2-"));
    expect(loadOverrides(empty)).toEqual({});
    rmSync(empty, { recursive: true, force: true });
  });
});

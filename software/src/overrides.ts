// Remote tuning: a whitelist of safe settings that can be changed at runtime
// (via /set or the conversation set_config tool) and persisted to overrides.json
// in dataDir, merged on top of config.json at load and hot-applied without a
// restart.
//
// Safety: the pump caps (maxSecondsPerRun / maxSecondsPerDay) can only ever be
// LOWERED relative to their config.json values, never raised — the config.json
// value is the hard ceiling. Everything here is pure and unit-tested; the actual
// hot-apply to the running Pump happens in the controller.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";

export const SETTABLE_KEYS = [
  "brain.analysisIntervalMinutes",
  "brain.model",
  "brain.deepModel",
  "light.onHour",
  "light.offHour",
  "pump.maxSecondsPerRun",
  "pump.maxSecondsPerDay",
] as const;
export type SettableKey = (typeof SETTABLE_KEYS)[number];

// The config.json pump caps — the ceiling caps may never be raised above.
export interface BaseCaps {
  maxSecondsPerRun: number;
  maxSecondsPerDay: number;
}

export type OverrideMap = Partial<Record<SettableKey, number | string>>;

export function isSettableKey(key: string): key is SettableKey {
  return (SETTABLE_KEYS as readonly string[]).includes(key);
}

// Coerce and range-check a raw value for a key. Returns null if invalid.
export function coerceOverrideValue(key: SettableKey, raw: string | number): number | string | null {
  if (key === "brain.model" || key === "brain.deepModel") {
    const s = String(raw).trim();
    return s.length ? s : null;
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  if (key === "light.onHour" || key === "light.offHour") {
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  }
  if (key === "brain.analysisIntervalMinutes") {
    return n > 0 ? Math.floor(n) : null;
  }
  // pump caps
  return n > 0 ? n : null;
}

export interface SetResult {
  ok: boolean;
  key?: SettableKey;
  value?: number | string;
  error?: string;
}

// Validate a proposed change: whitelist membership, value coercion, and the
// cap-lowering-only rule. Does not mutate anything.
export function validateOverride(key: string, raw: string | number, base: BaseCaps): SetResult {
  if (!isSettableKey(key)) return { ok: false, error: `"${key}" is not a settable key` };
  const value = coerceOverrideValue(key, raw);
  if (value === null) return { ok: false, error: `invalid value for ${key}` };
  if (key === "pump.maxSecondsPerRun" && (value as number) > base.maxSecondsPerRun) {
    return { ok: false, error: `pump.maxSecondsPerRun can only be lowered (config cap ${base.maxSecondsPerRun})` };
  }
  if (key === "pump.maxSecondsPerDay" && (value as number) > base.maxSecondsPerDay) {
    return { ok: false, error: `pump.maxSecondsPerDay can only be lowered (config cap ${base.maxSecondsPerDay})` };
  }
  return { ok: true, key, value };
}

function setEffective(cfg: Config, key: SettableKey, value: number | string): void {
  switch (key) {
    case "brain.analysisIntervalMinutes":
      cfg.brain.analysisIntervalMinutes = value as number;
      break;
    case "brain.model":
      cfg.brain.model = value as string;
      break;
    case "brain.deepModel":
      cfg.brain.deepModel = value as string;
      break;
    case "light.onHour":
      cfg.light.onHour = value as number;
      break;
    case "light.offHour":
      cfg.light.offHour = value as number;
      break;
    case "pump.maxSecondsPerRun":
      cfg.pump.maxSecondsPerRun = value as number;
      break;
    case "pump.maxSecondsPerDay":
      cfg.pump.maxSecondsPerDay = value as number;
      break;
  }
}

export function effectiveValue(cfg: Config, key: SettableKey): number | string {
  switch (key) {
    case "brain.analysisIntervalMinutes":
      return cfg.brain.analysisIntervalMinutes;
    case "brain.model":
      return cfg.brain.model;
    case "brain.deepModel":
      return cfg.brain.deepModel;
    case "light.onHour":
      return cfg.light.onHour;
    case "light.offHour":
      return cfg.light.offHour;
    case "pump.maxSecondsPerRun":
      return cfg.pump.maxSecondsPerRun;
    case "pump.maxSecondsPerDay":
      return cfg.pump.maxSecondsPerDay;
  }
}

// Merge an overrides map onto the effective config in place. Invalid entries
// (including caps above the config.json ceiling) are skipped, so a stale or
// hand-edited overrides.json can never weaken a safety cap.
export function applyOverrides(cfg: Config, overrides: OverrideMap, base: BaseCaps): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const res = validateOverride(key, value, base);
    if (res.ok && res.key !== undefined && res.value !== undefined) setEffective(cfg, res.key, res.value);
  }
}

export function overridesPath(dataDir: string): string {
  return join(dataDir, "overrides.json");
}

export function loadOverrides(dataDir: string): OverrideMap {
  const p = overridesPath(dataDir);
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
    const out: OverrideMap = {};
    for (const [k, v] of Object.entries(raw)) {
      if (isSettableKey(k) && (typeof v === "number" || typeof v === "string")) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveOverrides(dataDir: string, overrides: OverrideMap): void {
  writeFileSync(overridesPath(dataDir), JSON.stringify(overrides, null, 2));
}

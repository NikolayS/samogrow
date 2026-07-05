// Configuration: config.json for settings, environment variables for secrets.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Smart-plug protocol. "kasa" is the legacy TP-Link local protocol (TCP 9999,
// XOR cipher). "klap" is the encrypted KLAP handshake newer Kasa firmware
// (KP125M and other 2023+ devices) requires. When omitted, the transport is
// auto-detected: probe legacy 9999 first, fall back to KLAP. See hardware.ts.
export type PlugType = "kasa" | "klap";

export interface LightConfig {
  onHour: number; // local time, 24h
  offHour: number; // 16h photoperiod suits leafy herbs
  plugHost: string; // LAN IP / hostname of the light's smart plug
  plugType?: PlugType; // omitted => auto-detect (legacy 9999, then KLAP)
}

export interface PumpConfig {
  plugHost: string; // LAN IP / hostname of the pump's smart plug
  plugType?: PlugType; // omitted => auto-detect (legacy 9999, then KLAP)
  maxSecondsPerRun: number;
  maxSecondsPerDay: number; // hard safety cap: never flood the reservoir
  mlPerSecond: number; // calibrate with a measuring cup
  minWatts: number; // health floor: a run drawing less means dead/unplugged/dry
  // Which garden unit (camera label) this pump waters. Omitted => the first
  // unit. Only that unit's brain verdict drives the pump; other units' water
  // needs become manual top-up reminders.
  unit?: string;
}

// A single garden unit's camera: one source URL plus a human label ("diy",
// "auk", …). One camera == one unit; each is analysed on its own.
export interface CameraDevice {
  url: string;
  label: string;
}

// Raw config form for a device: a plain URL string (back-compat) or an object
// with an optional label. Normalised into CameraDevice[] at load.
export type RawCameraDevice = string | { url: string; label?: string };

export interface CameraConfig {
  // Each entry is a camera source, one per garden unit:
  //   rtsp://user:pass@host:554/stream1   (snapshotted via ffmpeg)
  //   http(s)://host/snapshot.jpg          (single-frame HTTP snapshot)
  devices: CameraDevice[];
  width: number;
  height: number;
}

export interface BrainConfig {
  model: string;
  deepModel: string; // stronger model for the weekly deep review
  analysisIntervalMinutes: number; // photo + AI check cadence during light hours
  dailyReportHour: number;
  deepReviewDay: number; // 0=Sun..6=Sat; day the weekly deep review runs
  deepReviewHour: number; // local hour the weekly deep review runs
  maxTokens: number;
}

export interface Config {
  light: LightConfig;
  pump: PumpConfig;
  cameras: CameraConfig;
  brain: BrainConfig;
  mockHardware: boolean;
  dataDir: string;
  photoDir: string;
  // secrets, from env
  telegramToken: string;
  telegramChatId: string; // your user id; bot only obeys this chat
  anthropicApiKey: string;
  // TP-Link cloud account, required only for KLAP plugs (see hardware.ts).
  tplinkEmail: string;
  tplinkPassword: string;
}

const DEFAULTS = {
  // plugType is intentionally omitted so it stays undefined => auto-detect.
  light: { onHour: 7, offHour: 23, plugHost: "" } as LightConfig,
  pump: {
    plugHost: "",
    maxSecondsPerRun: 30,
    maxSecondsPerDay: 180,
    mlPerSecond: 15,
    minWatts: 2,
  } as PumpConfig,
  cameras: {
    devices: [{ url: "rtsp://user:pass@192.168.1.50:554/stream1", label: "unit-1" }],
    width: 1920,
    height: 1080,
  } as CameraConfig,
  brain: {
    model: "claude-haiku-4-5-20251001",
    deepModel: "claude-sonnet-5",
    analysisIntervalMinutes: 120,
    dailyReportHour: 9,
    deepReviewDay: 0, // Sunday
    deepReviewHour: 10,
    maxTokens: 1024,
  } as BrainConfig,
};

// Normalise the raw cameras.devices array (plain strings and/or {url,label}
// objects) into labelled CameraDevice[]. A missing/blank label falls back to
// "unit-N" (1-based by position); duplicate labels are disambiguated with a
// "-N" suffix so per-unit trend separation always has a unique key.
export function normalizeDevices(raw: unknown): CameraDevice[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CameraDevice[] = [];
  raw.forEach((d, i) => {
    let url: string | undefined;
    let label: string | undefined;
    if (typeof d === "string") {
      url = d;
    } else if (d && typeof d === "object" && typeof (d as { url?: unknown }).url === "string") {
      url = (d as { url: string }).url;
      const l = (d as { label?: unknown }).label;
      if (typeof l === "string" && l.trim()) label = l.trim();
    }
    if (!url) return; // skip malformed entries
    let final = label ?? `unit-${i + 1}`;
    if (seen.has(final)) final = `${final}-${i + 1}`;
    seen.add(final);
    out.push({ url, label: final });
  });
  return out;
}

export function loadConfig(path = "config.json"): Config {
  let raw: Partial<Record<string, unknown>> = {};
  if (existsSync(path)) {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  }
  const dataDir =
    typeof raw.dataDir === "string"
      ? raw.dataDir.replace(/^~/, homedir())
      : join(homedir(), ".samogrow");
  const photoDir = join(dataDir, "photos");
  mkdirSync(photoDir, { recursive: true });

  const rawCameras = (raw.cameras as { devices?: unknown } | undefined) ?? {};
  const devices =
    rawCameras.devices !== undefined ? normalizeDevices(rawCameras.devices) : DEFAULTS.cameras.devices;

  const cfg: Config = {
    light: { ...DEFAULTS.light, ...(raw.light as object) },
    pump: { ...DEFAULTS.pump, ...(raw.pump as object) },
    cameras: { ...DEFAULTS.cameras, ...rawCameras, devices },
    brain: { ...DEFAULTS.brain, ...(raw.brain as object) },
    mockHardware: Boolean(raw.mockHardware) || process.env.SAMOGROW_MOCK === "1",
    dataDir,
    photoDir,
    telegramToken: process.env.SAMOGROW_TELEGRAM_TOKEN ?? "",
    telegramChatId: process.env.SAMOGROW_TELEGRAM_CHAT_ID ?? "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    tplinkEmail: process.env.SAMOGROW_TPLINK_EMAIL ?? "",
    tplinkPassword: process.env.SAMOGROW_TPLINK_PASSWORD ?? "",
  };
  return cfg;
}

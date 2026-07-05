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
}

export interface CameraConfig {
  // Each entry is a camera source URL:
  //   rtsp://user:pass@host:554/stream1   (snapshotted via ffmpeg)
  //   http(s)://host/snapshot.jpg          (single-frame HTTP snapshot)
  devices: string[];
  width: number;
  height: number;
}

export interface BrainConfig {
  model: string;
  analysisIntervalMinutes: number; // photo + AI check cadence during light hours
  dailyReportHour: number;
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
  } as PumpConfig,
  cameras: {
    devices: ["rtsp://user:pass@192.168.1.50:554/stream1"],
    width: 1920,
    height: 1080,
  } as CameraConfig,
  brain: {
    model: "claude-haiku-4-5-20251001",
    analysisIntervalMinutes: 120,
    dailyReportHour: 9,
    maxTokens: 1024,
  } as BrainConfig,
};

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

  const cfg: Config = {
    light: { ...DEFAULTS.light, ...(raw.light as object) },
    pump: { ...DEFAULTS.pump, ...(raw.pump as object) },
    cameras: { ...DEFAULTS.cameras, ...(raw.cameras as object) },
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

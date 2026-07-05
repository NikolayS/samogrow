// Configuration: config.json for settings, environment variables for secrets.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LightConfig {
  onHour: number; // local time, 24h
  offHour: number; // 16h photoperiod suits leafy herbs
  gpioPin: number; // relay IN1
  kasaHost?: string; // if set, use a Kasa smart plug instead of GPIO relay
}

export interface PumpConfig {
  gpioPin: number; // relay IN2 (or MOSFET gate)
  maxSecondsPerRun: number;
  maxSecondsPerDay: number; // hard safety cap: never flood the counter
  mlPerSecond: number; // calibrate with a measuring cup
}

export interface CameraConfig {
  // Each entry: "picamera:0", "picamera:1", or a USB device like "/dev/video0"
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
}

const DEFAULTS = {
  light: { onHour: 7, offHour: 23, gpioPin: 17 } as LightConfig,
  pump: {
    gpioPin: 27,
    maxSecondsPerRun: 30,
    maxSecondsPerDay: 180,
    mlPerSecond: 15,
  } as PumpConfig,
  cameras: { devices: ["picamera:0"], width: 1920, height: 1080 } as CameraConfig,
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
  };
  return cfg;
}

// Camera capture: one timestamped JPEG per configured device into cfg.photoDir.
//
//   "picamera:N"  -> rpicam-still --camera N -o <path> -t 2000 -n
//   "/dev/videoX" -> fswebcam --no-banner -r WxH <path>
//
// Mock mode writes a tiny but valid JPEG placeholder. One camera failing must
// never break the capture cycle.

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Config } from "./config.ts";

const exec = promisify(execFile);

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [cam] ${msg}`);
}

// A minimal valid 1x1 baseline JPEG, used as the mock-mode placeholder.
const PLACEHOLDER_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
    "AAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==",
  "base64",
);

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeName(device: string): string {
  return device.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

async function captureOne(cfg: Config, device: string): Promise<string> {
  const path = join(cfg.photoDir, `${timestamp()}_${safeName(device)}.jpg`);

  if (cfg.mockHardware) {
    await writeFile(path, PLACEHOLDER_JPEG);
    log(`[mock] wrote placeholder ${path}`);
    return path;
  }

  if (device.startsWith("picamera:")) {
    const n = device.slice("picamera:".length);
    await exec("rpicam-still", ["--camera", n, "-o", path, "-t", "2000", "-n"]);
  } else if (device.startsWith("/dev/video")) {
    await exec("fswebcam", [
      "-d",
      device,
      "--no-banner",
      "-r",
      `${cfg.cameras.width}x${cfg.cameras.height}`,
      path,
    ]);
  } else {
    throw new Error(`unknown camera device "${device}"`);
  }
  log(`captured ${path}`);
  return path;
}

// Capture every configured camera. Failures are logged and skipped so a single
// broken camera can't stop the control loop. Returns the paths that succeeded.
export async function captureAll(cfg: Config): Promise<string[]> {
  const results = await Promise.allSettled(
    cfg.cameras.devices.map((d) => captureOne(cfg, d)),
  );
  const paths: string[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") paths.push(r.value);
    else log(`camera ${cfg.cameras.devices[i]} failed: ${r.reason}`);
  }
  return paths;
}

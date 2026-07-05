// Camera capture from LAN Wi-Fi cameras: one timestamped JPEG per source.
//
//   rtsp://user:pass@host:554/stream1  -> ffmpeg -rtsp_transport tcp -i <url> -frames:v 1
//   http(s)://host/snapshot.jpg         -> HTTP GET (Basic auth if creds in URL)
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

export type CameraKind = "rtsp" | "http";

// Classify a camera source URL. Throws on anything that isn't an RTSP or
// HTTP(S) URL so misconfiguration surfaces loudly.
export function classifyCameraSource(url: string): CameraKind {
  if (/^rtsps?:\/\//i.test(url)) return "rtsp";
  if (/^https?:\/\//i.test(url)) return "http";
  throw new Error(`unsupported camera source "${url}" (expected rtsp:// or http(s)://)`);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// A short, filesystem-safe id for a source URL (host only, never credentials).
export function sourceId(url: string): string {
  let host = url;
  try {
    host = new URL(url).host || url;
  } catch {
    /* keep raw */
  }
  return host.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "cam";
}

async function httpSnapshot(url: string, path: string): Promise<void> {
  const u = new URL(url);
  const headers: Record<string, string> = {};
  if (u.username || u.password) {
    const creds = Buffer.from(
      `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`,
    ).toString("base64");
    headers["Authorization"] = `Basic ${creds}`;
    u.username = "";
    u.password = "";
  }
  const res = await fetch(u.toString(), { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${u.host}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

async function captureOne(cfg: Config, url: string): Promise<string> {
  const path = join(cfg.photoDir, `${timestamp()}_${sourceId(url)}.jpg`);

  if (cfg.mockHardware) {
    await writeFile(path, PLACEHOLDER_JPEG);
    log(`[mock] wrote placeholder ${path}`);
    return path;
  }

  const kind = classifyCameraSource(url);
  if (kind === "rtsp") {
    await exec(
      "ffmpeg",
      ["-nostdin", "-rtsp_transport", "tcp", "-i", url, "-frames:v", "1", "-y", path],
      { timeout: 20_000 },
    );
  } else {
    await httpSnapshot(url, path);
  }
  log(`captured ${path}`);
  return path;
}

// Capture every configured camera. Failures are logged and skipped so a single
// broken camera can't stop the control loop. Returns the paths that succeeded.
export async function captureAll(cfg: Config): Promise<string[]> {
  const results = await Promise.allSettled(cfg.cameras.devices.map((d) => captureOne(cfg, d)));
  const paths: string[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") paths.push(r.value);
    else log(`camera ${cfg.cameras.devices[i]} failed: ${r.reason}`);
  }
  return paths;
}

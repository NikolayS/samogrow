// Timelapse: build an MP4 from the archived JPEGs of camera 0 via ffmpeg
// (2 fps, scaled to 720p, yuv420p for Telegram compatibility). Source frames
// are capped and evenly sampled. Works in mock mode with the placeholder JPEGs.

import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Config } from "./config.ts";
import { sourceId } from "./camera.ts";

const exec = promisify(execFile);

// Evenly sample up to `max` items, preserving order and always keeping the
// first and last frame. Pure + unit-tested.
export function sampleFrames<T>(frames: T[], max: number): T[] {
  if (max <= 0) return [];
  if (frames.length <= max) return frames.slice();
  if (max === 1) return [frames[0]!];
  const out: T[] = [];
  const step = (frames.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(frames[Math.round(i * step)]!);
  return out;
}

// All archived JPEGs for a camera within the last `days` days, chronological.
export async function listCameraFrames(cfg: Config, cameraIndex: number, days: number): Promise<string[]> {
  const device = cfg.cameras.devices[cameraIndex];
  if (!device) return [];
  const suffix = `_${sourceId(device.url)}.jpg`;
  const cutoff = Date.now() - days * 86_400_000;
  let names: string[];
  try {
    names = (await readdir(cfg.photoDir)).filter((n) => n.endsWith(suffix)).sort();
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const n of names) {
    const p = join(cfg.photoDir, n);
    try {
      if ((await stat(p)).mtimeMs >= cutoff) paths.push(p);
    } catch {
      /* skip unreadable */
    }
  }
  return paths;
}

export interface TimelapseResult {
  outPath: string;
  frameCount: number;
}

// Build the timelapse MP4 from camera 0. Returns null when there are no frames.
export async function buildTimelapse(
  cfg: Config,
  outPath: string,
  opts: { days: number; maxFrames?: number; fps?: number },
): Promise<TimelapseResult | null> {
  const maxFrames = opts.maxFrames ?? 300;
  const fps = opts.fps ?? 2;
  const frames = sampleFrames(await listCameraFrames(cfg, 0, opts.days), maxFrames);
  if (frames.length === 0) return null;

  const work = await mkdtemp(join(tmpdir(), "samogrow-tl-"));
  try {
    // Copy the sampled frames to a sequential name so ffmpeg's image2 demuxer
    // reads them in order regardless of the original timestamps.
    for (let i = 0; i < frames.length; i++) {
      await copyFile(frames[i]!, join(work, `f${String(i).padStart(6, "0")}.jpg`));
    }
    await exec(
      "ffmpeg",
      [
        "-y",
        "-framerate", String(fps),
        "-i", join(work, "f%06d.jpg"),
        "-vf", "scale=-2:720,format=yuv420p",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        outPath,
      ],
      { timeout: 120_000 },
    );
    return { outPath, frameCount: frames.length };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

import { expect, test, describe, afterAll } from "bun:test";
import { loadConfig, normalizeDevices } from "./config.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "samogrow-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function writeConfig(obj: unknown): string {
  const p = join(scratch, `config-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

describe("loadConfig", () => {
  test("applies defaults when the file is absent", () => {
    const cfg = loadConfig(join(scratch, "does-not-exist.json"));
    expect(cfg.light.onHour).toBe(7);
    expect(cfg.light.offHour).toBe(23);
    expect(cfg.pump.maxSecondsPerRun).toBe(30);
    expect(cfg.pump.maxSecondsPerDay).toBe(180);
    expect(cfg.brain.analysisIntervalMinutes).toBe(120);
  });

  test("merges partial sections over defaults", () => {
    const path = writeConfig({ dataDir: scratch, light: { onHour: 20, offHour: 8 } });
    const cfg = loadConfig(path);
    expect(cfg.light.onHour).toBe(20); // overridden
    expect(cfg.light.offHour).toBe(8); // overridden
    expect(cfg.light.plugType).toBeUndefined(); // omitted => auto-detect transport
    expect(cfg.pump.mlPerSecond).toBe(15); // untouched section keeps defaults
  });

  test("reads secrets from the environment, not the file", () => {
    const prev = process.env.SAMOGROW_TELEGRAM_CHAT_ID;
    process.env.SAMOGROW_TELEGRAM_CHAT_ID = "123456";
    try {
      const cfg = loadConfig(writeConfig({ dataDir: scratch }));
      expect(cfg.telegramChatId).toBe("123456");
    } finally {
      if (prev === undefined) delete process.env.SAMOGROW_TELEGRAM_CHAT_ID;
      else process.env.SAMOGROW_TELEGRAM_CHAT_ID = prev;
    }
  });

  test("mock mode follows SAMOGROW_MOCK", () => {
    const prev = process.env.SAMOGROW_MOCK;
    process.env.SAMOGROW_MOCK = "1";
    try {
      expect(loadConfig(writeConfig({ dataDir: scratch })).mockHardware).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SAMOGROW_MOCK;
      else process.env.SAMOGROW_MOCK = prev;
    }
  });

  test("a plain-string camera keeps back-compat with an index-based label", () => {
    const cfg = loadConfig(writeConfig({ dataDir: scratch, cameras: { devices: ["rtsp://cam/a"] } }));
    expect(cfg.cameras.devices).toEqual([{ url: "rtsp://cam/a", label: "unit-1" }]);
  });

  test("a mix of string and {url,label} device forms parses to labelled units", () => {
    const cfg = loadConfig(
      writeConfig({
        dataDir: scratch,
        cameras: {
          devices: [{ url: "rtsp://cam/a", label: "diy" }, "rtsp://cam/b"],
        },
      }),
    );
    expect(cfg.cameras.devices).toEqual([
      { url: "rtsp://cam/a", label: "diy" },
      { url: "rtsp://cam/b", label: "unit-2" }, // string fallback keeps its positional index
    ]);
  });

  test("the default single camera is one labelled unit", () => {
    const cfg = loadConfig(join(scratch, "does-not-exist.json"));
    expect(cfg.cameras.devices).toHaveLength(1);
    expect(cfg.cameras.devices[0]!.label).toBe("unit-1");
  });
});

describe("normalizeDevices", () => {
  test("labels both device formats, defaulting to unit-N by position", () => {
    expect(normalizeDevices(["rtsp://a", { url: "rtsp://b", label: "auk" }])).toEqual([
      { url: "rtsp://a", label: "unit-1" },
      { url: "rtsp://b", label: "auk" },
    ]);
  });

  test("disambiguates duplicate labels so trend keys stay unique", () => {
    const out = normalizeDevices([
      { url: "rtsp://a", label: "bed" },
      { url: "rtsp://b", label: "bed" },
    ]);
    expect(out[0]!.label).toBe("bed");
    expect(out[1]!.label).not.toBe("bed");
    expect(new Set(out.map((d) => d.label)).size).toBe(2);
  });

  test("skips malformed entries and blank labels fall back to unit-N", () => {
    expect(normalizeDevices([{ url: "rtsp://a", label: "  " }, 42, { nope: 1 }])).toEqual([
      { url: "rtsp://a", label: "unit-1" },
    ]);
    expect(normalizeDevices("not-an-array")).toEqual([]);
  });
});

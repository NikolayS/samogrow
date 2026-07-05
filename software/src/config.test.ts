import { expect, test, describe, afterAll } from "bun:test";
import { loadConfig } from "./config.ts";
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
    expect(cfg.light.plugType).toBe("kasa"); // default preserved
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
});

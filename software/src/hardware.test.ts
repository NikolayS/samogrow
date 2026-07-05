import { expect, test, describe } from "bun:test";
import { clampPumpSeconds, kasaEncrypt, kasaDecrypt } from "./hardware.ts";

describe("clampPumpSeconds", () => {
  const budget = { maxPerRun: 30, maxPerDay: 180, usedToday: 0 };

  test("passes through a value within all limits", () => {
    expect(clampPumpSeconds(10, budget)).toBe(10);
  });

  test("clamps to max per run", () => {
    expect(clampPumpSeconds(100, budget)).toBe(30);
  });

  test("clamps to remaining daily budget", () => {
    expect(clampPumpSeconds(30, { ...budget, usedToday: 170 })).toBe(10);
  });

  test("returns 0 when daily budget is exhausted", () => {
    expect(clampPumpSeconds(30, { ...budget, usedToday: 180 })).toBe(0);
    expect(clampPumpSeconds(30, { ...budget, usedToday: 200 })).toBe(0);
  });

  test("rejects zero and negative requests", () => {
    expect(clampPumpSeconds(0, budget)).toBe(0);
    expect(clampPumpSeconds(-5, budget)).toBe(0);
  });

  test("takes the tightest of per-run and remaining", () => {
    expect(clampPumpSeconds(1000, { maxPerRun: 30, maxPerDay: 180, usedToday: 165 })).toBe(15);
  });
});

describe("kasa cipher", () => {
  test("encrypt/decrypt round-trips (payload after the 4-byte header)", () => {
    const msg = JSON.stringify({ system: { set_relay_state: { state: 1 } } });
    const framed = kasaEncrypt(msg);
    expect(framed.readUInt32BE(0)).toBe(Buffer.byteLength(msg));
    expect(kasaDecrypt(framed.subarray(4))).toBe(msg);
  });

  test("first ciphertext byte is key XOR first plaintext byte", () => {
    const framed = kasaEncrypt("{");
    expect(framed[4]).toBe(0xab ^ "{".charCodeAt(0));
  });
});

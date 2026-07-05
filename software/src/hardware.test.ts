import { expect, test, describe } from "bun:test";
import { clampPumpSeconds, kasaEncrypt, kasaDecrypt, Pump, type Switch } from "./hardware.ts";

// A stand-in for a smart-plug switch that records calls, so we can assert the
// pump's safety behaviour over the plug-based path without any hardware.
class FakeSwitch implements Switch {
  isOn = false;
  onCount = 0;
  offCount = 0;
  async on(): Promise<void> {
    this.isOn = true;
    this.onCount++;
  }
  async off(): Promise<void> {
    this.isOn = false;
    this.offCount++;
  }
}

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

describe("Pump (plug-driven safety)", () => {
  // Tiny durations keep the test fast: maxPerRun 20ms, maxPerDay 50ms.
  const mkPump = (sw: Switch) => new Pump(sw, 0.02, 0.05, 10);

  test("enforces the daily budget across repeated runs", async () => {
    const sw = new FakeSwitch();
    const pump = mkPump(sw);

    expect(await pump.timedPumpRun(1)).toBeCloseTo(0.02, 6); // clamped to per-run
    expect(await pump.timedPumpRun(1)).toBeCloseTo(0.02, 6);
    expect(await pump.timedPumpRun(1)).toBeCloseTo(0.01, 6); // only 0.01 left in the day
    expect(await pump.timedPumpRun(1)).toBe(0); // budget exhausted

    expect(pump.budgetUsedSeconds).toBeCloseTo(0.05, 6);
    expect(pump.budgetUsedSeconds).toBeLessThanOrEqual(pump.budgetTotalSeconds);
  });

  test("always leaves the plug off, re-sending OFF after each run", async () => {
    const sw = new FakeSwitch();
    const pump = mkPump(sw);
    await pump.timedPumpRun(1);
    expect(sw.isOn).toBe(false);
    expect(sw.onCount).toBe(1);
    // ensureOff() sends OFF twice per run (belt-and-suspenders).
    expect(sw.offCount).toBe(2);
  });

  test("waterMl converts and respects caps", async () => {
    const sw = new FakeSwitch();
    const pump = mkPump(sw); // 10 ml/s, max 0.02s/run => max 0.2 ml/run
    const dispensed = await pump.waterMl(1000);
    expect(dispensed).toBeCloseTo(0.2, 6);
  });

  test("ensureOff swallows switch errors and still turns off", async () => {
    let calls = 0;
    const flaky: Switch = {
      isOn: true,
      async on() {},
      async off() {
        calls++;
        throw new Error("network blip");
      },
    };
    const pump = new Pump(flaky, 0.02, 0.05, 10);
    await pump.ensureOff(); // must not throw
    expect(calls).toBe(2); // both attempts made
  });
});

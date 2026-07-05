import { expect, test, describe } from "bun:test";
import {
  clampPumpSeconds,
  kasaEncrypt,
  kasaDecrypt,
  klapAuthHash,
  klapServerHash,
  klapHandshake2Payload,
  deriveKlapKeys,
  klapEncrypt,
  klapDecrypt,
  Pump,
  type Switch,
} from "./hardware.ts";

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

describe("klap crypto", () => {
  // Fixed inputs => reproducible known-answer vectors. The expected hex strings
  // were computed independently (node:crypto) from these seeds and credentials,
  // matching python-kasa's KlapTransportV2 derivation.
  const email = "grower@example.com";
  const password = "hunter2pw";
  const local = Buffer.alloc(16, 0x11);
  const remote = Buffer.alloc(16, 0x22);
  const auth = klapAuthHash(email, password);

  test("auth_hash = sha256(sha1(email) + sha1(password))", () => {
    expect(auth.toString("hex")).toBe(
      "3b05b5e564fe61b6d90eed5a158109ce024a425ccf50b0f62b6fdf77dc960883",
    );
  });

  test("handshake1 server hash = sha256(local + remote + auth)", () => {
    expect(klapServerHash(local, remote, auth).toString("hex")).toBe(
      "4fe8e3dc7651836bebeeadadb770a90318ba28d9e488338bb7f6b879038deaaa",
    );
  });

  test("handshake2 payload = sha256(remote + local + auth), differs from server hash", () => {
    expect(klapHandshake2Payload(local, remote, auth).toString("hex")).toBe(
      "210ef698b473427a2794fd4e2d22b6d91383ce7641c1b5c7acc86030d1f70f13",
    );
    expect(klapHandshake2Payload(local, remote, auth).equals(klapServerHash(local, remote, auth))).toBe(false);
  });

  test("derives 16-byte key, 12-byte iv, 28-byte sig, and initial seq", () => {
    const k = deriveKlapKeys(local, remote, auth);
    expect(k.key.length).toBe(16);
    expect(k.iv.length).toBe(12);
    expect(k.sig.length).toBe(28);
    expect(k.key.toString("hex")).toBe("471f7ca9beb85b010d32989338afaae4");
    expect(k.iv.toString("hex")).toBe("7a7a1a18674b857048733f13");
    expect(k.sig.toString("hex")).toBe("df80739103488eabc07a256f2d1b94a012590b733e8fedef0faaddb2");
    expect(k.seq).toBe(723754578);
  });

  test("encrypt produces the known signature(32) + ciphertext for a fixed seq", () => {
    const k = deriveKlapKeys(local, remote, auth);
    const msg = JSON.stringify({ system: { set_relay_state: { state: 1 } } });
    // First request increments seq before use.
    const seq = k.seq + 1;
    const body = klapEncrypt(k, seq, msg);
    expect(seq).toBe(723754579);
    expect(body.toString("hex")).toBe(
      "d385bfaa51a029b5fa3233ffe4f2259ec5f650d1d75fd58e2651d344c663ca66" +
        "adb7061b22d4bac97ea2773edc9699e2e5139db576f6705e5e6eac034cc9c499" +
        "0a902b321784b4cd97550c329fb36ed2",
    );
  });

  test("encrypt/decrypt round-trips at the same seq", () => {
    const k = deriveKlapKeys(local, remote, auth);
    const msg = JSON.stringify({ system: { set_relay_state: { state: 0 } } });
    const seq = k.seq + 1;
    const body = klapEncrypt(k, seq, msg);
    expect(klapDecrypt(k, seq, body)).toBe(msg);
  });

  test("verifying handshake1 rejects a wrong-credential server hash", () => {
    const good = klapServerHash(local, remote, auth);
    const wrong = klapServerHash(local, remote, klapAuthHash(email, "wrong-password"));
    expect(good.equals(wrong)).toBe(false);
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

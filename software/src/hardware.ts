// Hardware control: light + pump switches with pump safety caps.
//
// GPIO on Raspberry Pi is driven by shelling out to `pinctrl` (Pi 5 friendly),
// falling back to `gpioset` (libgpiod) if pinctrl is missing. Outputs are
// active-high. The light can alternatively be a TP-Link Kasa smart plug spoken
// to over the local network (TCP 9999, trivial XOR-autokey cipher).
//
// In mock mode (macOS / no hardware) every switch is log-only.

import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";
import type { Config } from "./config.ts";

const exec = promisify(execFile);

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [hw] ${msg}`);
}

export interface Switch {
  readonly isOn: boolean;
  on(): Promise<void>;
  off(): Promise<void>;
}

// ---------------------------------------------------------------------------
// GPIO backend detection (done once, lazily).

type GpioTool = "pinctrl" | "gpioset";
let gpioToolPromise: Promise<GpioTool> | null = null;

async function has(cmd: string): Promise<boolean> {
  try {
    await exec("sh", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

async function detectGpioTool(): Promise<GpioTool> {
  if (!gpioToolPromise) {
    gpioToolPromise = (async () => {
      if (await has("pinctrl")) return "pinctrl";
      if (await has("gpioset")) return "gpioset";
      // Nothing found — default to pinctrl and let the write error surface.
      log("neither pinctrl nor gpioset found; defaulting to pinctrl");
      return "pinctrl";
    })();
  }
  return gpioToolPromise;
}

async function gpioWrite(pin: number, value: boolean): Promise<void> {
  const tool = await detectGpioTool();
  if (tool === "pinctrl") {
    // `pinctrl set <pin> op dh|dl` — set as output, drive high/low.
    await exec("pinctrl", ["set", String(pin), "op", value ? "dh" : "dl"]);
  } else {
    // libgpiod. `-c` selects the chip on v2; harmless-ish elsewhere.
    await exec("gpioset", ["gpiochip0", `${pin}=${value ? 1 : 0}`]);
  }
}

class GpioSwitch implements Switch {
  isOn = false;
  constructor(
    private readonly pin: number,
    private readonly name: string,
  ) {}
  async on(): Promise<void> {
    await gpioWrite(this.pin, true);
    this.isOn = true;
    log(`${this.name} ON (gpio ${this.pin})`);
  }
  async off(): Promise<void> {
    await gpioWrite(this.pin, false);
    this.isOn = false;
    log(`${this.name} OFF (gpio ${this.pin})`);
  }
}

class MockSwitch implements Switch {
  isOn = false;
  constructor(private readonly name: string) {}
  async on(): Promise<void> {
    this.isOn = true;
    log(`[mock] ${this.name} ON`);
  }
  async off(): Promise<void> {
    this.isOn = false;
    log(`[mock] ${this.name} OFF`);
  }
}

// ---------------------------------------------------------------------------
// Kasa smart plug (TP-Link) local protocol.
//
// The device listens on TCP 9999. Payloads are JSON, encrypted with an
// XOR-autokey cipher seeded at 0xAB, and framed with a 4-byte big-endian
// length prefix.

export function kasaEncrypt(input: string): Buffer {
  const body = Buffer.from(input, "utf8");
  const out = Buffer.alloc(body.length + 4);
  out.writeUInt32BE(body.length, 0);
  let key = 0xab;
  for (let i = 0; i < body.length; i++) {
    key = key ^ body[i]!;
    out[i + 4] = key;
  }
  return out;
}

export function kasaDecrypt(body: Buffer): string {
  const out = Buffer.alloc(body.length);
  let key = 0xab;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    out[i] = c ^ key;
    key = c;
  }
  return out.toString("utf8");
}

function kasaSend(host: string, payload: object, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port: 9999 });
    const chunks: Buffer[] = [];
    let expected = -1;
    const done = (err: Error | null, val?: unknown) => {
      sock.destroy();
      err ? reject(err) : resolve(val);
    };
    sock.setTimeout(timeoutMs, () => done(new Error(`kasa timeout to ${host}`)));
    sock.on("error", (e) => done(e));
    sock.on("connect", () => sock.write(kasaEncrypt(JSON.stringify(payload))));
    sock.on("data", (d: Buffer) => {
      chunks.push(d);
      const buf = Buffer.concat(chunks);
      if (expected < 0 && buf.length >= 4) expected = buf.readUInt32BE(0);
      if (expected >= 0 && buf.length >= expected + 4) {
        try {
          done(null, JSON.parse(kasaDecrypt(buf.subarray(4, expected + 4))));
        } catch (e) {
          done(e as Error);
        }
      }
    });
    sock.on("close", () => {
      if (expected < 0) done(new Error("kasa closed with no response"));
    });
  });
}

class KasaSwitch implements Switch {
  isOn = false;
  constructor(private readonly host: string) {}
  private async setRelay(state: 0 | 1): Promise<void> {
    await kasaSend(this.host, { system: { set_relay_state: { state } } });
  }
  async on(): Promise<void> {
    await this.setRelay(1);
    this.isOn = true;
    log(`light (kasa ${this.host}) ON`);
  }
  async off(): Promise<void> {
    await this.setRelay(0);
    this.isOn = false;
    log(`light (kasa ${this.host}) OFF`);
  }
}

// ---------------------------------------------------------------------------
// Pump safety.

export interface PumpBudget {
  maxPerRun: number;
  maxPerDay: number;
  usedToday: number;
}

// Pure clamp used by the pump and covered by tests. Never returns more than a
// single run allows, never more than the remaining daily budget, never < 0.
export function clampPumpSeconds(requested: number, b: PumpBudget): number {
  if (!(requested > 0)) return 0;
  const remaining = Math.max(0, b.maxPerDay - b.usedToday);
  return Math.max(0, Math.min(requested, b.maxPerRun, remaining));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Pump {
  private usedToday = 0;
  private day = new Date().toDateString();
  private running = false;

  constructor(
    private readonly sw: Switch,
    private readonly maxSecondsPerRun: number,
    private readonly maxSecondsPerDay: number,
    private readonly mlPerSecond: number,
  ) {}

  private rollDay(): void {
    const today = new Date().toDateString();
    if (today !== this.day) {
      this.day = today;
      this.usedToday = 0;
    }
  }

  get budgetUsedSeconds(): number {
    this.rollDay();
    return this.usedToday;
  }
  get budgetTotalSeconds(): number {
    return this.maxSecondsPerDay;
  }

  // Run the pump for a clamped number of seconds; always turns off in finally.
  // Returns the number of seconds actually run.
  async timedPumpRun(seconds: number): Promise<number> {
    this.rollDay();
    if (this.running) {
      log("pump already running; ignoring concurrent request");
      return 0;
    }
    const secs = clampPumpSeconds(seconds, {
      maxPerRun: this.maxSecondsPerRun,
      maxPerDay: this.maxSecondsPerDay,
      usedToday: this.usedToday,
    });
    if (secs <= 0) {
      log(`pump run of ${seconds}s clamped to 0 (budget used ${this.usedToday}/${this.maxSecondsPerDay}s)`);
      return 0;
    }
    this.running = true;
    try {
      await this.sw.on();
      await sleep(secs * 1000);
    } finally {
      await this.sw.off();
      this.running = false;
      this.usedToday += secs;
    }
    log(`pump ran ${secs}s (budget used ${this.usedToday}/${this.maxSecondsPerDay}s)`);
    return secs;
  }

  // Convert millilitres to a timed run. Returns millilitres actually dispensed.
  async waterMl(ml: number): Promise<number> {
    const secs = await this.timedPumpRun(ml / this.mlPerSecond);
    return secs * this.mlPerSecond;
  }
}

// ---------------------------------------------------------------------------

export class Hardware {
  readonly light: Switch;
  readonly pump: Pump;

  constructor(cfg: Config) {
    const mock = cfg.mockHardware;
    if (mock) {
      this.light = new MockSwitch("light");
    } else if (cfg.light.kasaHost) {
      this.light = new KasaSwitch(cfg.light.kasaHost);
    } else {
      this.light = new GpioSwitch(cfg.light.gpioPin, "light");
    }
    const pumpSwitch: Switch = mock
      ? new MockSwitch("pump")
      : new GpioSwitch(cfg.pump.gpioPin, "pump");
    this.pump = new Pump(
      pumpSwitch,
      cfg.pump.maxSecondsPerRun,
      cfg.pump.maxSecondsPerDay,
      cfg.pump.mlPerSecond,
    );
  }
}

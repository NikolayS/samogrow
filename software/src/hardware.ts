// Hardware control: light + pump, both driven by LAN Wi-Fi smart plugs.
//
// The garden device has no compute of its own — this service runs on any
// always-on machine (laptop / VM) and talks to smart plugs over the local
// network. v1 speaks the TP-Link Kasa local protocol directly (TCP 9999,
// trivial XOR-autokey cipher). Tapo plugs use an encrypted KLAP handshake that
// is out of scope for v1 (see below).
//
// Watering = pump plug ON for N seconds, then OFF. The pump safety caps are the
// ONLY flood/dry-run protection, so OFF is sent defensively: always in a
// finally, always re-sent, and forced OFF on startup and shutdown in case a
// previous run crashed mid-watering.
//
// In mock mode (no hardware) every switch is log-only.

import { connect } from "node:net";
import type { Config, PlugType } from "./config.ts";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [hw] ${msg}`);
}

export interface Switch {
  readonly isOn: boolean;
  on(): Promise<void>;
  off(): Promise<void>;
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
  constructor(
    private readonly host: string,
    private readonly name: string,
  ) {}
  private async setRelay(state: 0 | 1): Promise<void> {
    await kasaSend(this.host, { system: { set_relay_state: { state } } });
  }
  async on(): Promise<void> {
    await this.setRelay(1);
    this.isOn = true;
    log(`${this.name} (kasa ${this.host}) ON`);
  }
  async off(): Promise<void> {
    await this.setRelay(0);
    this.isOn = false;
    log(`${this.name} (kasa ${this.host}) OFF`);
  }
}

// Build a plug switch for the given type. Tapo is intentionally unsupported in
// v1: its local API uses an encrypted KLAP/passthrough handshake that needs
// account credentials and is far more involved than Kasa's. Use a Kasa-class
// plug (KP115 / EP10 / HS103) for v1, or drive the Tapo plug via an external CLI.
function makePlugSwitch(type: PlugType | undefined, host: string, name: string): Switch {
  if ((type ?? "kasa") === "tapo") {
    throw new Error(
      `${name}: Tapo plugs are not supported in v1. Use a Kasa-class plug ` +
        `(KP115/EP10/HS103) with plugType "kasa", or drive the Tapo plug via an external CLI.`,
    );
  }
  return new KasaSwitch(host, name);
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

  // Belt-and-suspenders OFF: send it, then send it again. Safe to call any time
  // (startup, shutdown, after a crash) — turning an already-off plug off is a
  // no-op on the device but guarantees the pump can never be left running.
  async ensureOff(): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.sw.off();
      } catch (e) {
        log(`pump ensureOff attempt ${attempt + 1} failed: ${e}`);
      }
    }
  }

  // Run the pump for a clamped number of seconds; always turns off (twice) in
  // finally. Returns the number of seconds actually run.
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
      await this.ensureOff();
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
    if (cfg.mockHardware) {
      this.light = new MockSwitch("light");
      this.pump = new Pump(
        new MockSwitch("pump"),
        cfg.pump.maxSecondsPerRun,
        cfg.pump.maxSecondsPerDay,
        cfg.pump.mlPerSecond,
      );
      return;
    }
    this.light = makePlugSwitch(cfg.light.plugType, cfg.light.plugHost, "light");
    this.pump = new Pump(
      makePlugSwitch(cfg.pump.plugType, cfg.pump.plugHost, "pump"),
      cfg.pump.maxSecondsPerRun,
      cfg.pump.maxSecondsPerDay,
      cfg.pump.mlPerSecond,
    );
  }
}

// Hardware control: light + pump, both driven by LAN Wi-Fi smart plugs.
//
// The garden device has no compute of its own — this service runs on any
// always-on machine (laptop / VM) and talks to smart plugs over the local
// network. Two transports are supported, both local-only:
//   - "kasa":  legacy TP-Link local protocol (TCP 9999, XOR-autokey cipher).
//   - "klap":  the encrypted KLAP handshake newer Kasa firmware (KP125M and
//              other 2023+ devices) requires; HTTP on port 80, AES-128-CBC.
// When plugType is omitted the transport is auto-detected: probe legacy 9999
// first (short timeout), fall back to KLAP, and remember what worked.
//
// Watering = pump plug ON for N seconds, then OFF. The pump safety caps are the
// ONLY flood/dry-run protection, so OFF is sent defensively: always in a
// finally, always re-sent, and forced OFF on startup and shutdown in case a
// previous run crashed mid-watering.
//
// In mock mode (no hardware) every switch is log-only.

import { connect, type Socket } from "node:net";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Config, PlugType } from "./config.ts";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [hw] ${msg}`);
}

export interface Switch {
  readonly isOn: boolean;
  on(): Promise<void>;
  off(): Promise<void>;
  // Instantaneous power draw in watts, or null if the plug has no energy meter
  // / the reading failed. Used for pump-health monitoring (KP125M emeter).
  readPowerWatts?(): Promise<number | null>;
}

// Parse a Kasa/KLAP emeter get_realtime response into watts. Newer firmware
// reports milliwatts (power_mw); older reports watts (power).
export function emeterWatts(resp: unknown): number | null {
  const rt = (resp as { emeter?: { get_realtime?: Record<string, unknown> } } | null)?.emeter?.get_realtime;
  if (!rt) return null;
  if (typeof rt.power_mw === "number") return rt.power_mw / 1000;
  if (typeof rt.power === "number") return rt.power;
  return null;
}

export class MockSwitch implements Switch {
  isOn = false;
  watts = 5; // fake healthy draw; tests set this low to exercise the lockout
  constructor(private readonly name: string) {}
  async on(): Promise<void> {
    this.isOn = true;
    log(`[mock] ${this.name} ON`);
  }
  async off(): Promise<void> {
    this.isOn = false;
    log(`[mock] ${this.name} OFF`);
  }
  async readPowerWatts(): Promise<number | null> {
    return this.isOn ? this.watts : 0;
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
  async readPowerWatts(): Promise<number | null> {
    try {
      return emeterWatts(await kasaSend(this.host, { emeter: { get_realtime: {} } }));
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// KLAP protocol (newer Kasa firmware, e.g. KP125M — no longer speaks port 9999).
//
// Reference: python-kasa's KlapTransportV2 (kasa/transports/klaptransport.py).
// HTTP on port 80. Handshake authenticates with the TP-Link cloud account the
// plug was provisioned with (email + password) — no cloud round-trip; the auth
// hash is exchanged locally. python-kasa also tries "default" credentials
// (blank / Kasa-setup) as a fallback; we implement cloud-credential auth only.
//
//   handshake1: POST /app/handshake1, body = 16-byte random local_seed.
//               response = remote_seed(16) + server_hash(32); the device sets a
//               TP_SESSIONID cookie. Verify server_hash equals
//               sha256(local_seed + remote_seed + auth_hash).
//   handshake2: POST /app/handshake2, body = sha256(remote_seed + local_seed +
//               auth_hash), carrying the session cookie. HTTP 200 = success.
//   session keys (all sha256 over local_seed + remote_seed + auth_hash):
//               key = sha256("lsk" + ...)[:16]           (AES-128 key)
//               fulliv = sha256("iv"  + ...); iv = fulliv[:12];
//               seq = signed int32 from fulliv[-4:]      (initial sequence)
//               sig = sha256("ldk" + ...)[:28]           (signature prefix)
//   request:    seq += 1; iv_full = iv + int32be(seq);
//               ciphertext = AES-128-CBC(key, iv_full, PKCS7(json));
//               body = sha256(sig + int32be(seq) + ciphertext) + ciphertext;
//               POST /app/request?seq=<seq>, carrying the cookie.
//               response body = signature(32) + ciphertext, decrypted with the
//               same key/iv_full.
//
// auth_hash = sha256(sha1(email) + sha1(password)).

const sha256 = (b: Buffer): Buffer => createHash("sha256").update(b).digest();
const sha1 = (b: Buffer): Buffer => createHash("sha1").update(b).digest();
const int32be = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n | 0, 0);
  return b;
};

export function klapAuthHash(email: string, password: string): Buffer {
  return sha256(Buffer.concat([sha1(Buffer.from(email, "utf8")), sha1(Buffer.from(password, "utf8"))]));
}

// The hash the device returns in handshake1; recomputed locally to authenticate
// the device (and confirm our credentials match) before deriving session keys.
export function klapServerHash(localSeed: Buffer, remoteSeed: Buffer, authHash: Buffer): Buffer {
  return sha256(Buffer.concat([localSeed, remoteSeed, authHash]));
}

// The body we send in handshake2 (note the reversed seed order vs. handshake1).
export function klapHandshake2Payload(localSeed: Buffer, remoteSeed: Buffer, authHash: Buffer): Buffer {
  return sha256(Buffer.concat([remoteSeed, localSeed, authHash]));
}

export interface KlapKeys {
  key: Buffer; // AES-128 key (16 bytes)
  iv: Buffer; // IV prefix (12 bytes); full IV = iv + int32be(seq)
  sig: Buffer; // signature prefix (28 bytes)
  seq: number; // sequence counter; incremented before each request
}

export function deriveKlapKeys(localSeed: Buffer, remoteSeed: Buffer, authHash: Buffer): KlapKeys {
  const seeds = Buffer.concat([localSeed, remoteSeed, authHash]);
  const fulliv = sha256(Buffer.concat([Buffer.from("iv"), seeds]));
  return {
    key: sha256(Buffer.concat([Buffer.from("lsk"), seeds])).subarray(0, 16),
    iv: fulliv.subarray(0, 12),
    sig: sha256(Buffer.concat([Buffer.from("ldk"), seeds])).subarray(0, 28),
    seq: fulliv.readInt32BE(28),
  };
}

// Encrypt one request at the given sequence number. Returns signature(32) +
// ciphertext, the exact body POSTed to /app/request?seq=<seq>.
export function klapEncrypt(k: KlapKeys, seq: number, msg: string): Buffer {
  const seqBuf = int32be(seq);
  const cipher = createCipheriv("aes-128-cbc", k.key, Buffer.concat([k.iv, seqBuf]));
  const ct = Buffer.concat([cipher.update(Buffer.from(msg, "utf8")), cipher.final()]);
  const signature = sha256(Buffer.concat([k.sig, seqBuf, ct]));
  return Buffer.concat([signature, ct]);
}

// Decrypt a response body (signature(32) + ciphertext) at the same seq used for
// the request that produced it.
export function klapDecrypt(k: KlapKeys, seq: number, body: Buffer): string {
  const decipher = createDecipheriv("aes-128-cbc", k.key, Buffer.concat([k.iv, int32be(seq)]));
  const pt = Buffer.concat([decipher.update(body.subarray(32)), decipher.final()]);
  return pt.toString("utf8");
}

// Pull the TP_SESSIONID cookie out of a Set-Cookie header, returned as a
// ready-to-send "TP_SESSIONID=..." Cookie value (or null if absent).
function parseSessionCookie(setCookie: string | null): string | null {
  const m = setCookie?.match(/TP_SESSIONID=[^;]+/);
  return m ? m[0] : null;
}

// A single KLAP session to one plug: handshakes lazily, carries the session
// cookie, and re-handshakes once if a request fails (session expiry).
class KlapConnection {
  private keys: KlapKeys | null = null;
  private cookie: string | null = null;
  // The KLAP session is bound to the TCP connection, so the whole handshake +
  // every request MUST reuse one keep-alive socket (a fresh connection per call
  // — e.g. what fetch() does — lands handshake2/requests on a dead session and
  // the device answers HTTP 400). We hold the socket and serialize requests
  // over it (the seq counter must also increment strictly in order).
  private sock: Socket | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly host: string,
    private readonly authHash: Buffer,
    private readonly timeoutMs = 5000,
  ) {}

  private connectSocket(): Promise<Socket> {
    if (this.sock && !this.sock.destroyed) return Promise.resolve(this.sock);
    return new Promise((resolve, reject) => {
      const sock = connect({ host: this.host, port: 80 });
      sock.setNoDelay(true);
      const t = setTimeout(() => {
        sock.destroy();
        reject(new Error(`KLAP connect to ${this.host} timed out`));
      }, this.timeoutMs);
      sock.once("connect", () => {
        clearTimeout(t);
        this.sock = sock;
        resolve(sock);
      });
      sock.once("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
      // When the socket eventually closes, drop it and the session so the next
      // request reconnects and re-handshakes.
      sock.once("close", () => {
        if (this.sock === sock) {
          this.sock = null;
          this.keys = null;
        }
      });
    });
  }

  private resetSocket(): void {
    this.sock?.destroy();
    this.sock = null;
    this.keys = null;
  }

  // One HTTP/1.1 POST over the persistent socket, response read by Content-Length.
  private async post(
    path: string,
    body: Buffer,
    withCookie: boolean,
  ): Promise<{ status: number; body: Buffer; cookie: string | null }> {
    const sock = await this.connectSocket();
    const head =
      [
        `POST ${path} HTTP/1.1`,
        `Host: ${this.host}`,
        `Content-Type: application/octet-stream`,
        `Content-Length: ${body.length}`,
        ...(withCookie && this.cookie ? [`Cookie: ${this.cookie}`] : []),
        `Connection: keep-alive`,
      ].join("\r\n") + "\r\n\r\n";
    return new Promise((resolve, reject) => {
      let buf = Buffer.alloc(0);
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.off("data", onData);
        sock.off("error", onErr);
        sock.off("close", onErr);
      };
      const onErr = (e?: Error) => {
        cleanup();
        this.resetSocket();
        reject(e ?? new Error(`KLAP socket to ${this.host} closed mid-request`));
      };
      const onData = (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        const sep = buf.indexOf("\r\n\r\n");
        if (sep < 0) return;
        const header = buf.subarray(0, sep).toString("latin1");
        const cl = Number(header.match(/content-length:\s*(\d+)/i)?.[1] ?? 0);
        const bodyBuf = buf.subarray(sep + 4);
        if (bodyBuf.length < cl) return;
        cleanup();
        resolve({
          status: Number(header.match(/HTTP\/1\.\d (\d+)/)?.[1] ?? 0),
          body: bodyBuf.subarray(0, cl),
          cookie: parseSessionCookie(header.match(/set-cookie:\s*([^\r\n]+)/i)?.[1] ?? null),
        });
      };
      const timer = setTimeout(() => {
        cleanup();
        this.resetSocket();
        reject(new Error(`KLAP ${path} to ${this.host} timed out`));
      }, this.timeoutMs);
      sock.on("data", onData);
      sock.once("error", onErr);
      sock.once("close", onErr);
      sock.write(Buffer.concat([Buffer.from(head, "latin1"), body]));
    });
  }

  private async handshake(): Promise<void> {
    const localSeed = randomBytes(16);
    const r1 = await this.post("/app/handshake1", localSeed, false);
    if (r1.status !== 200 || r1.body.length < 48) {
      throw new Error(`KLAP handshake1 to ${this.host} failed (HTTP ${r1.status}, ${r1.body.length} bytes)`);
    }
    const remoteSeed = r1.body.subarray(0, 16);
    const serverHash = r1.body.subarray(16, 48);
    if (r1.cookie) this.cookie = r1.cookie;
    if (!klapServerHash(localSeed, remoteSeed, this.authHash).equals(serverHash)) {
      throw new Error(
        `KLAP auth to ${this.host} failed — check SAMOGROW_TPLINK_EMAIL / SAMOGROW_TPLINK_PASSWORD`,
      );
    }
    const r2 = await this.post("/app/handshake2", klapHandshake2Payload(localSeed, remoteSeed, this.authHash), true);
    if (r2.status !== 200) throw new Error(`KLAP handshake2 to ${this.host} failed (HTTP ${r2.status})`);
    this.keys = deriveKlapKeys(localSeed, remoteSeed, this.authHash);
  }

  private async send(payload: object): Promise<unknown> {
    const k = this.keys!;
    k.seq += 1;
    const body = klapEncrypt(k, k.seq, JSON.stringify(payload));
    const r = await this.post(`/app/request?seq=${k.seq}`, body, true);
    if (r.status !== 200) throw new Error(`KLAP request to ${this.host} failed (HTTP ${r.status})`);
    return JSON.parse(klapDecrypt(k, k.seq, r.body));
  }

  private async doRequest(payload: object): Promise<unknown> {
    if (!this.keys) await this.handshake();
    try {
      return await this.send(payload);
    } catch {
      // Session/socket likely dropped — reset the connection, re-handshake once.
      this.resetSocket();
      await this.handshake();
      return await this.send(payload);
    }
  }

  // Serialize: KLAP requests share one socket and a strictly-incrementing seq,
  // so they must not overlap. Each call waits for the previous to finish.
  request(payload: object): Promise<unknown> {
    const run = this.queue.then(() => this.doRequest(payload));
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }
}

class KlapSwitch implements Switch {
  isOn = false;
  private readonly conn: KlapConnection;
  constructor(
    private readonly host: string,
    private readonly name: string,
    authHash: Buffer,
  ) {
    this.conn = new KlapConnection(host, authHash);
  }
  private async setRelay(state: 0 | 1): Promise<void> {
    await this.conn.request({ system: { set_relay_state: { state } } });
  }
  async on(): Promise<void> {
    await this.setRelay(1);
    this.isOn = true;
    log(`${this.name} (klap ${this.host}) ON`);
  }
  async off(): Promise<void> {
    await this.setRelay(0);
    this.isOn = false;
    log(`${this.name} (klap ${this.host}) OFF`);
  }
  async readPowerWatts(): Promise<number | null> {
    // Kasa-branded KLAP devices (KP125M) still expose the legacy emeter module.
    try {
      return emeterWatts(await this.conn.request({ emeter: { get_realtime: {} } }));
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Plug transport selection.

export interface TplinkCreds {
  email: string;
  password: string;
}

function requireKlapAuth(name: string, creds: TplinkCreds): Buffer {
  if (!creds.email || !creds.password) {
    throw new Error(
      `${name}: KLAP plug needs TP-Link cloud credentials — set ` +
        `SAMOGROW_TPLINK_EMAIL and SAMOGROW_TPLINK_PASSWORD.`,
    );
  }
  return klapAuthHash(creds.email, creds.password);
}

// Auto-detecting switch: on first use, probe the legacy Kasa protocol (short
// timeout); if it answers, use it, otherwise fall back to KLAP. The chosen
// transport is cached for the process lifetime.
class AutoDetectSwitch implements Switch {
  private inner: Switch | null = null;
  private resolving: Promise<Switch> | null = null;
  constructor(
    private readonly host: string,
    private readonly name: string,
    private readonly creds: TplinkCreds,
  ) {}

  get isOn(): boolean {
    return this.inner?.isOn ?? false;
  }

  private resolve(): Promise<Switch> {
    if (this.inner) return Promise.resolve(this.inner);
    if (this.resolving) return this.resolving;
    this.resolving = (async () => {
      try {
        await kasaSend(this.host, { system: { get_sysinfo: {} } }, 1500);
        log(`${this.name}: detected legacy Kasa protocol at ${this.host}`);
        this.inner = new KasaSwitch(this.host, this.name);
      } catch {
        log(`${this.name}: legacy Kasa silent, using KLAP at ${this.host}`);
        this.inner = new KlapSwitch(this.host, this.name, requireKlapAuth(this.name, this.creds));
      }
      return this.inner;
    })();
    return this.resolving;
  }

  async on(): Promise<void> {
    await (await this.resolve()).on();
  }
  async off(): Promise<void> {
    await (await this.resolve()).off();
  }
  async readPowerWatts(): Promise<number | null> {
    return (await (await this.resolve()).readPowerWatts?.()) ?? null;
  }
}

// Build a plug switch for the given transport. Omitted plugType auto-detects
// (legacy 9999, then KLAP). KLAP requires TP-Link cloud credentials in env.
function makePlugSwitch(type: PlugType | undefined, host: string, name: string, creds: TplinkCreds): Switch {
  if (type === "kasa") return new KasaSwitch(host, name);
  if (type === "klap") return new KlapSwitch(host, name, requireKlapAuth(name, creds));
  return new AutoDetectSwitch(host, name, creds);
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

// Delay after turn-on before sampling power draw, and the minimum run length for
// a sample to be trustworthy (short runs may sample before the motor spins up).
const HEALTH_SAMPLE_MS = 2000;

export class Pump {
  private usedToday = 0;
  private day = new Date().toDateString();
  private running = false;
  // Lockout lives here in the hardware layer alongside the caps, so NO caller
  // (bot, brain, conversation tool, /set) can bypass it without an explicit
  // override. The controller decides when to lock; the Pump enforces it.
  private locked = false;
  private lockReason = "";
  private lastWatts: number | null = null;
  private lastSeconds = 0;

  constructor(
    private readonly sw: Switch,
    private maxSecondsPerRun: number,
    private maxSecondsPerDay: number,
    private readonly mlPerSecond: number,
  ) {}

  lock(reason: string): void {
    this.locked = true;
    this.lockReason = reason;
  }
  unlock(): void {
    this.locked = false;
    this.lockReason = "";
  }
  get isLocked(): boolean {
    return this.locked;
  }
  get lockoutReason(): string {
    return this.lockReason;
  }
  // Power draw sampled during the most recent run (null if unavailable) and its
  // length in seconds — read by the controller to judge pump health.
  get lastRunWatts(): number | null {
    return this.lastWatts;
  }
  get lastRunSeconds(): number {
    return this.lastSeconds;
  }

  // Hot-adjust the caps at runtime (remote /set tuning). The clamp in
  // clampPumpSeconds always reads the current caps, so a lowered cap takes
  // effect on the very next run regardless of the caller.
  setCaps(maxSecondsPerRun: number, maxSecondsPerDay: number): void {
    if (maxSecondsPerRun > 0) this.maxSecondsPerRun = maxSecondsPerRun;
    if (maxSecondsPerDay > 0) this.maxSecondsPerDay = maxSecondsPerDay;
  }

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
  // finally. Returns the number of seconds actually run. When locked, refuses
  // unless `override` is set (the explicit manual-water path). Samples power
  // draw ~2s in for health monitoring.
  async timedPumpRun(seconds: number, override = false): Promise<number> {
    this.rollDay();
    this.lastWatts = null;
    this.lastSeconds = 0;
    if (this.locked && !override) {
      log(`pump LOCKED (${this.lockReason}); refusing run`);
      return 0;
    }
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
      const sampleAt = Math.min(HEALTH_SAMPLE_MS, Math.max(0, secs * 1000 - 50));
      await sleep(sampleAt);
      this.lastWatts = (await this.sw.readPowerWatts?.()) ?? null;
      await sleep(secs * 1000 - sampleAt);
    } finally {
      await this.ensureOff();
      this.running = false;
      this.usedToday += secs;
      this.lastSeconds = secs;
    }
    log(`pump ran ${secs}s (budget used ${this.usedToday}/${this.maxSecondsPerDay}s${this.lastWatts !== null ? `, ${this.lastWatts.toFixed(1)}W` : ""})`);
    return secs;
  }

  // Convert millilitres to a timed run. Returns millilitres actually dispensed.
  async waterMl(ml: number, override = false): Promise<number> {
    const secs = await this.timedPumpRun(ml / this.mlPerSecond, override);
    return secs * this.mlPerSecond;
  }
}

// ---------------------------------------------------------------------------

export class Hardware {
  readonly light: Switch;
  // Null in manual watering mode (no pump.plugHost configured): there is no pump
  // plug to switch, so no pump is built, nothing is forced off on startup, and
  // pump-health monitoring is disabled. The controller reminds the owner to water
  // by hand instead. Add pump.plugHost to upgrade to automatic top-up.
  readonly pump: Pump | null;
  readonly isManual: boolean;

  constructor(cfg: Config) {
    this.isManual = !cfg.pump.plugHost.trim();
    if (cfg.mockHardware) {
      this.light = new MockSwitch("light");
      this.pump = this.isManual
        ? null
        : new Pump(
            new MockSwitch("pump"),
            cfg.pump.maxSecondsPerRun,
            cfg.pump.maxSecondsPerDay,
            cfg.pump.mlPerSecond,
          );
      return;
    }
    const creds: TplinkCreds = { email: cfg.tplinkEmail, password: cfg.tplinkPassword };
    this.light = makePlugSwitch(cfg.light.plugType, cfg.light.plugHost, "light", creds);
    this.pump = this.isManual
      ? null
      : new Pump(
          makePlugSwitch(cfg.pump.plugType, cfg.pump.plugHost, "pump", creds),
          cfg.pump.maxSecondsPerRun,
          cfg.pump.maxSecondsPerDay,
          cfg.pump.mlPerSecond,
        );
  }
}

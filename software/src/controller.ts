// Controller: the scheduling loop and the API the bot drives.
//
// Checks every minute:
//   - light schedule (on between onHour/offHour, with a manual override + expiry)
//   - AI analysis every analysisIntervalMinutes during light hours
//   - a daily report at dailyReportHour
//
// It also exposes status/photoNow/waterNow/lightOverride/lastAnalysis for the bot.

import type { Config } from "./config.ts";
import type { Hardware } from "./hardware.ts";
import type { Db } from "./state.ts";
import type { Brain, Verdict } from "./brain.ts";

// --- pure schedule helpers (unit tested) ---------------------------------

// Is `hour` within the [onHour, offHour) photoperiod? Handles overnight
// windows where onHour > offHour (e.g. on 20:00, off 08:00).
export function isWithinPhotoperiod(hour: number, onHour: number, offHour: number): boolean {
  if (onHour === offHour) return false; // zero-length window
  if (onHour < offHour) return hour >= onHour && hour < offHour;
  return hour >= onHour || hour < offHour; // wraps past midnight
}

export type OverrideMode = "on" | "off";
export interface LightOverride {
  mode: OverrideMode;
  until: number; // epoch ms
}

// Desired light state, honouring an unexpired manual override.
export function resolveLightState(
  now: Date,
  onHour: number,
  offHour: number,
  override: LightOverride | null,
): boolean {
  if (override && override.until > now.getTime()) return override.mode === "on";
  return isWithinPhotoperiod(now.getHours(), onHour, offHour);
}

// --- callbacks the bot registers -----------------------------------------

export interface AlertPayload {
  verdict: Verdict;
  photos: string[];
}
export interface ReportPayload {
  text: string;
  photo?: string;
}
export interface ControllerCallbacks {
  onAlert?: (p: AlertPayload) => void;
  onReport?: (p: ReportPayload) => void;
}

export interface Status {
  lightOn: boolean;
  override: LightOverride | null;
  pumpBudgetUsedSeconds: number;
  pumpBudgetTotalSeconds: number;
  uptimeSeconds: number;
  lastVerdict: Verdict | null;
  lastAnalysisTs: string | null;
}

export class Controller {
  private override: LightOverride | null = null;
  private lastAnalysisMs = 0;
  private lastReportDay = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly startedAt = Date.now();
  private callbacks: ControllerCallbacks = {};
  private analyzing = false;
  private firstTick = true;

  constructor(
    private readonly cfg: Config,
    private readonly hw: Hardware,
    private readonly db: Db,
    private readonly brain: Brain,
  ) {}

  setCallbacks(cb: ControllerCallbacks): void {
    this.callbacks = cb;
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private log(msg: string): void {
    console.log(`[${new Date().toISOString()}] [ctrl] ${msg}`);
  }

  private async tick(): Promise<void> {
    try {
      const now = new Date();
      // Clear an expired override.
      if (this.override && this.override.until <= now.getTime()) {
        this.override = null;
        this.log("manual override expired; back to schedule");
      }

      const desired = resolveLightState(now, this.cfg.light.onHour, this.cfg.light.offHour, this.override);
      if (this.firstTick) {
        this.log(
          `light schedule decision: ${desired ? "ON" : "OFF"} (hour ${now.getHours()}, ` +
            `window ${this.cfg.light.onHour}:00–${this.cfg.light.offHour}:00)`,
        );
        this.firstTick = false;
      }
      if (desired !== this.hw.light.isOn) {
        this.log(`light schedule -> ${desired ? "ON" : "OFF"} (hour ${now.getHours()})`);
        desired ? await this.hw.light.on() : await this.hw.light.off();
      }

      // Analysis cadence, during light hours only.
      const intervalMs = this.cfg.brain.analysisIntervalMinutes * 60_000;
      if (desired && Date.now() - this.lastAnalysisMs >= intervalMs) {
        this.lastAnalysisMs = Date.now();
        await this.runAnalysis();
      }

      // Daily report.
      const day = now.toDateString();
      if (now.getHours() === this.cfg.brain.dailyReportHour && day !== this.lastReportDay) {
        this.lastReportDay = day;
        this.sendDailyReport();
      }
    } catch (e) {
      this.log(`tick error: ${e}`);
    }
  }

  // --- analysis + actions --------------------------------------------------

  async runAnalysis(): Promise<Verdict | null> {
    if (this.analyzing) return null;
    this.analyzing = true;
    try {
      const { captureAll } = await import("./camera.ts");
      const photos = await captureAll(this.cfg);
      if (photos.length === 0) {
        this.log("no photos captured; skipping analysis");
        return null;
      }
      const { verdict, raw } = await this.brain.analyze(photos, {
        hoursSinceLastTopUp: this.db.hoursSinceLastTopUp(),
        pumpBudgetUsedSeconds: this.hw.pump.budgetUsedSeconds,
        pumpBudgetTotalSeconds: this.hw.pump.budgetTotalSeconds,
        lightOn: this.hw.light.isOn,
        recentEvents: this.db.recentEvents(10).map((e) => ({ ts: e.ts, kind: e.kind })),
      });
      this.db.saveAnalysis({ photoPaths: photos, model: this.cfg.brain.model, verdict, raw });
      this.db.logEvent("analysis", { healthScore: verdict.healthScore, alert: verdict.alert });
      this.log(`analysis: health ${verdict.healthScore}/10 — ${verdict.summary}`);

      if (verdict.waterTopUpMl > 0) {
        const ml = await this.hw.pump.waterMl(verdict.waterTopUpMl);
        if (ml > 0) this.db.logEvent("water", { requestedMl: verdict.waterTopUpMl, actualMl: ml, source: "brain" });
      }

      if (verdict.alert) {
        this.db.logEvent("alert", { reason: verdict.alertReason });
        this.callbacks.onAlert?.({ verdict, photos });
      }
      return verdict;
    } catch (e) {
      this.log(`analysis error: ${e}`);
      this.db.logEvent("error", { where: "analysis", message: String(e) });
      return null;
    } finally {
      this.analyzing = false;
    }
  }

  private buildReportText(): string {
    const rows = this.db.recentAnalyses(10);
    if (rows.length === 0) return "No analyses recorded yet.";
    const latest = rows[0]!;
    const trend = rows
      .slice()
      .reverse()
      .map((r) => r.verdict.healthScore)
      .join(" → ");
    const lines = [
      `🌿 Daily report`,
      `Health: ${latest.verdict.healthScore}/10`,
      latest.verdict.summary,
      latest.verdict.issues.length ? `Issues: ${latest.verdict.issues.join("; ")}` : "No issues noted.",
      `Health trend (older → newer): ${trend}`,
      `Pump budget today: ${this.hw.pump.budgetUsedSeconds}s / ${this.hw.pump.budgetTotalSeconds}s`,
    ];
    return lines.join("\n");
  }

  sendDailyReport(): void {
    const latest = this.db.lastAnalysis();
    this.callbacks.onReport?.({
      text: this.buildReportText(),
      photo: latest?.photoPaths[0],
    });
  }

  // --- bot-facing API ------------------------------------------------------

  status(): Status {
    const last = this.db.lastAnalysis();
    return {
      lightOn: this.hw.light.isOn,
      override: this.override,
      pumpBudgetUsedSeconds: this.hw.pump.budgetUsedSeconds,
      pumpBudgetTotalSeconds: this.hw.pump.budgetTotalSeconds,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      lastVerdict: last?.verdict ?? null,
      lastAnalysisTs: last?.ts ?? null,
    };
  }

  async photoNow(): Promise<string[]> {
    const { captureAll } = await import("./camera.ts");
    const photos = await captureAll(this.cfg);
    this.db.logEvent("photo", { count: photos.length });
    return photos;
  }

  async waterNow(ml: number): Promise<number> {
    const actual = await this.hw.pump.waterMl(ml);
    this.db.logEvent("water", { requestedMl: ml, actualMl: actual, source: "manual" });
    return actual;
  }

  async lightOverride(mode: OverrideMode | "auto", minutes: number): Promise<void> {
    if (mode === "auto") {
      this.override = null;
      this.log("light override cleared (auto)");
    } else {
      this.override = { mode, until: Date.now() + minutes * 60_000 };
      this.log(`light override ${mode} for ${minutes} min`);
    }
    // Apply immediately.
    const desired = resolveLightState(new Date(), this.cfg.light.onHour, this.cfg.light.offHour, this.override);
    if (desired !== this.hw.light.isOn) desired ? await this.hw.light.on() : await this.hw.light.off();
  }

  async analyzeNow(): Promise<Verdict | null> {
    this.lastAnalysisMs = Date.now();
    return this.runAnalysis();
  }

  lastAnalysis(): Verdict | null {
    return this.db.lastAnalysis()?.verdict ?? null;
  }

  reportText(): string {
    return this.buildReportText();
  }
}

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
import { DEFAULT_UNIT } from "./state.ts";
import type { Brain, Verdict, DeepReview, DeepRecommendation } from "./brain.ts";
import { dailyBuckets, describeDelta, lightOnHoursByDay, sparkline, weekOverWeek } from "./trends.ts";
import {
  applyOverrides,
  effectiveValue,
  saveOverrides,
  SETTABLE_KEYS,
  validateOverride,
  type BaseCaps,
  type OverrideMap,
  type SetResult,
} from "./overrides.ts";

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
// One garden unit's analysis in a cycle: its label, verdict, and photo.
export interface UnitAnalysis {
  label: string;
  verdict: Verdict;
  photo?: string;
}
// A combined per-cycle summary for a multi-unit garden — one Telegram message
// with compact per-unit lines instead of N separate alerts/reminders.
export interface CycleSummaryPayload {
  units: UnitAnalysis[]; // every unit analysed this cycle
  alerting: string[]; // labels of units that raised an alert
  reminders: { label: string; ml: number; repeat: boolean }[]; // manual top-up asks (non-pump units)
}
export interface ReportPayload {
  text: string;
  photo?: string;
}
export interface DeepReviewPayload {
  digest: string;
  recommendations: DeepRecommendation[];
  photo?: string;
}
export interface PumpAlertPayload {
  reason: string;
}
// Manual watering mode (no pump): the brain wants water, so ask the owner to add
// it by hand. `repeat` is true when a previous reminder is still unacknowledged.
export interface WaterReminderPayload {
  ml: number;
  text: string;
  repeat: boolean;
}
export interface ControllerCallbacks {
  onAlert?: (p: AlertPayload) => void;
  onReport?: (p: ReportPayload) => void;
  onDeepReview?: (p: DeepReviewPayload) => void;
  onPumpAlert?: (p: PumpAlertPayload) => void;
  onWaterReminder?: (p: WaterReminderPayload) => void;
  // Multi-unit gardens: one combined summary per analysis cycle.
  onCycleSummary?: (p: CycleSummaryPayload) => void;
}

// Human-readable "add roughly X ml (about Y)" reminder for manual watering.
// Under ~1 L we quote cups (240 ml), at/above 1 L we quote litres.
export function formatWaterReminder(ml: number): string {
  if (!(ml > 0)) return "🪣 Time to water: top up the reservoir";
  const approx =
    ml >= 1000 ? `${(ml / 1000).toFixed(1)} liters` : `${Math.max(0.25, Math.round((ml / 240) * 4) / 4)} cups`;
  return `🪣 Time to water: add roughly ${Math.round(ml)} ml (about ${approx}) to the reservoir`;
}

export interface Status {
  lightOn: boolean;
  override: LightOverride | null;
  manual: boolean; // manual watering mode (no pump) — the AI reminds the owner
  pumpBudgetUsedSeconds: number;
  pumpBudgetTotalSeconds: number;
  pumpLocked: boolean;
  pumpLockReason: string | null;
  uptimeSeconds: number;
  lastVerdict: Verdict | null;
  lastAnalysisTs: string | null;
}

// Minimum run length for a power sample to be trusted (short runs may sample
// before the motor is at full draw).
const PUMP_HEALTH_MIN_SECONDS = 2;

export class Controller {
  private override: LightOverride | null = null;
  private lastAnalysisMs = 0;
  private lastReportDay = "";
  private lastDeepReviewDay = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly startedAt = Date.now();
  private callbacks: ControllerCallbacks = {};
  private analyzing = false;
  private reviewing = false;
  private firstTick = true;
  // Outstanding, still-unacknowledged manual-water reminders, keyed by unit
  // label (ml per unit). Used to escalate ("still needs water") on the next
  // cycle and to answer /water with the current recommendation.
  private pendingManualWaterMl = new Map<string, number>();

  constructor(
    private readonly cfg: Config,
    private readonly hw: Hardware,
    private readonly db: Db,
    private readonly brain: Brain,
    // config.json pump caps (the ceiling caps may never be raised above) and the
    // persisted overrides map, for remote /set tuning.
    private readonly baseCaps: BaseCaps = { maxSecondsPerRun: cfg.pump.maxSecondsPerRun, maxSecondsPerDay: cfg.pump.maxSecondsPerDay },
    private readonly overrides: OverrideMap = {},
  ) {}

  setCallbacks(cb: ControllerCallbacks): void {
    this.callbacks = cb;
  }

  // Manual watering mode: no pump plug is configured, so watering is a Telegram
  // reminder to the owner rather than an automatic pump run.
  get isManual(): boolean {
    return this.hw.pump === null;
  }

  start(): void {
    this.restoreLockout();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
  }

  // Re-apply a persisted pump lockout after a restart (safety survives crashes).
  restoreLockout(): void {
    if (!this.hw.pump) return; // manual mode: no pump to lock
    const lk = this.db.getPumpLock();
    if (lk?.locked && !this.hw.pump.isLocked) {
      this.hw.pump.lock(lk.reason);
      this.log(`pump lockout restored: ${lk.reason}`);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private log(msg: string): void {
    console.log(`[${new Date().toISOString()}] [ctrl] ${msg}`);
  }

  // Switch the light and log the transition as an event (feeds the light-hours
  // trend). No-op when already in the desired state.
  private async applyLight(on: boolean): Promise<void> {
    if (on === this.hw.light.isOn) return;
    on ? await this.hw.light.on() : await this.hw.light.off();
    this.db.logEvent("light", { state: on ? "on" : "off" });
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
        await this.applyLight(desired);
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

      // Weekly deep review (configurable day + hour).
      if (
        now.getDay() === this.cfg.brain.deepReviewDay &&
        now.getHours() === this.cfg.brain.deepReviewHour &&
        day !== this.lastDeepReviewDay
      ) {
        this.lastDeepReviewDay = day;
        void this.runDeepReview();
      }
    } catch (e) {
      this.log(`tick error: ${e}`);
    }
  }

  // --- analysis + actions --------------------------------------------------

  // The garden unit the pump waters (config pump.unit, else the first camera's
  // label). Only this unit's verdict drives the pump; other units' water needs
  // become manual top-up reminders.
  pumpUnit(): string {
    return this.cfg.pump.unit ?? this.cfg.cameras.devices[0]?.label ?? DEFAULT_UNIT;
  }

  // Run one analysis cycle. Each camera is its own garden unit and gets its OWN
  // Claude call, verdict, and stored analysis tagged with the unit label. A
  // single-unit garden behaves exactly as before (one alert / one reminder); a
  // multi-unit garden emits one combined summary instead of N messages.
  async runAnalysis(only?: string): Promise<UnitAnalysis[]> {
    if (this.analyzing) return [];
    this.analyzing = true;
    try {
      return await this.analyzeUnits(only);
    } catch (e) {
      this.log(`analysis error: ${e}`);
      this.db.logEvent("error", { where: "analysis", message: String(e) });
      return [];
    } finally {
      this.analyzing = false;
    }
  }

  private async analyzeUnits(only?: string): Promise<UnitAnalysis[]> {
    const { captureUnits } = await import("./camera.ts");
    let captures = await captureUnits(this.cfg);
    if (only) captures = captures.filter((c) => c.label === only);
    if (captures.length === 0) {
      this.log(only ? `no photo for unit ${only}; skipping analysis` : "no photos captured; skipping analysis");
      return [];
    }

    const ctx = {
      hoursSinceLastTopUp: this.db.hoursSinceLastTopUp(),
      pumpBudgetUsedSeconds: this.hw.pump?.budgetUsedSeconds ?? 0,
      pumpBudgetTotalSeconds: this.hw.pump?.budgetTotalSeconds ?? 0,
      lightOn: this.hw.light.isOn,
      recentEvents: this.db.recentEvents(10).map((e) => ({ ts: e.ts, kind: e.kind })),
    };

    const combined = captures.length > 1;
    const pumpUnit = this.pumpUnit();
    const analyses: UnitAnalysis[] = [];
    const alerting: string[] = [];
    const reminders: { label: string; ml: number; repeat: boolean }[] = [];

    for (const cap of captures) {
      const { verdict, raw } = await this.brain.analyze([cap.path], ctx);
      // A low reservoir sight-gauge reading is itself alert-worthy and pump-health
      // context — fold it into the alert.
      if (verdict.reservoirLevel === "low" && !verdict.alert) {
        verdict.alert = true;
        verdict.alertReason = `${verdict.alertReason ? verdict.alertReason + "; " : ""}reservoir level low`;
      }

      this.db.saveAnalysis({ unit: cap.label, photoPaths: [cap.path], model: this.cfg.brain.model, verdict, raw });
      this.db.logEvent("analysis", {
        unit: cap.label,
        healthScore: verdict.healthScore,
        alert: verdict.alert,
        reservoir: verdict.reservoirLevel,
      });
      this.log(`analysis [${cap.label}]: health ${verdict.healthScore}/10 — ${verdict.summary}`);

      // Watering: only the pump's own unit drives the pump; every other unit's
      // water need (including all units in manual mode) becomes a reminder.
      const pump = this.hw.pump;
      if (pump && cap.label === pumpUnit) {
        if (verdict.waterTopUpMl > 0) {
          const ml = await pump.waterMl(verdict.waterTopUpMl);
          if (ml > 0) this.db.logEvent("water", { unit: cap.label, requestedMl: verdict.waterTopUpMl, actualMl: ml, source: "brain" });
          this.evalPumpHealth("brain");
        }
      } else if (verdict.waterTopUpMl > 0 || verdict.reservoirLevel === "low") {
        const repeat = this.recordReminder(cap.label, verdict.waterTopUpMl);
        reminders.push({ label: cap.label, ml: verdict.waterTopUpMl, repeat });
        if (!combined) {
          this.callbacks.onWaterReminder?.({ ml: verdict.waterTopUpMl, text: formatWaterReminder(verdict.waterTopUpMl), repeat });
        }
      }

      if (verdict.alert) {
        this.db.logEvent("alert", { unit: cap.label, reason: verdict.alertReason });
        alerting.push(cap.label);
      }
      analyses.push({ label: cap.label, verdict, photo: cap.path });
    }

    // Notify: a lone unit keeps today's per-unit alert; a multi-unit garden gets
    // one combined summary instead of N separate messages.
    if (!combined) {
      const a = analyses[0]!;
      if (a.verdict.alert) this.callbacks.onAlert?.({ verdict: a.verdict, photos: a.photo ? [a.photo] : [] });
    } else if (alerting.length > 0 || reminders.length > 0) {
      this.callbacks.onCycleSummary?.({ units: analyses, alerting, reminders });
    }

    return analyses;
  }

  // --- pump health ---------------------------------------------------------

  // Inspect the power draw of the run that just finished. Logs watts for trends
  // and, if the draw is below the health floor (dead / unplugged / running dry),
  // locks the pump against automatic runs and alerts the owner.
  private evalPumpHealth(source: string): void {
    if (!this.hw.pump) return; // manual mode: no pump to monitor
    const watts = this.hw.pump.lastRunWatts;
    const secs = this.hw.pump.lastRunSeconds;
    if (watts === null || secs < PUMP_HEALTH_MIN_SECONDS) return; // unmeasured / too short to trust
    this.db.logEvent("pumpRun", { watts, seconds: secs, source });
    if (watts < this.cfg.pump.minWatts && !this.hw.pump.isLocked) {
      const reason = `pump drew ${watts.toFixed(1)}W (< ${this.cfg.pump.minWatts}W) — dead, unplugged, or running dry`;
      this.hw.pump.lock(reason);
      this.db.setPumpLock(true, reason);
      this.db.logEvent("pumpLock", { reason, watts });
      this.log(`pump UNHEALTHY: ${reason}`);
      this.callbacks.onPumpAlert?.({ reason });
    }
  }

  // Clear a pump lockout (owner acknowledged the fix).
  enablePump(): void {
    if (!this.hw.pump) return; // manual mode: nothing to unlock
    this.hw.pump.unlock();
    this.db.setPumpLock(false, "");
    this.db.logEvent("pumpUnlock", {});
    this.log("pump lockout cleared");
  }

  pumpLocked(): boolean {
    return this.hw.pump?.isLocked ?? false;
  }

  // --- manual watering mode ------------------------------------------------

  // Record an outstanding manual-watering reminder for a unit so the next cycle
  // can escalate and /water can echo the current recommendation. Returns whether
  // this unit already had an unacknowledged reminder (i.e. a repeat). Does not
  // fire the callback — the caller decides per-unit vs. combined delivery.
  private recordReminder(label: string, ml: number): boolean {
    const repeat = (this.pendingManualWaterMl.get(label) ?? 0) > 0;
    this.pendingManualWaterMl.set(label, ml);
    this.db.logEvent("waterReminder", { unit: label, ml, repeat });
    this.log(`manual watering reminder [${label}]: ~${ml} ml${repeat ? " (repeat)" : ""}`);
    return repeat;
  }

  // The ml the owner is currently being asked to add by hand (0 = none pending).
  // Across a multi-unit garden this is the total outstanding across units.
  manualWaterRecommendation(): number {
    let pending = 0;
    for (const ml of this.pendingManualWaterMl.values()) pending += ml;
    return pending || (this.lastAnalysis()?.waterTopUpMl ?? 0);
  }

  // Owner acknowledged they watered by hand (tapped [Done ✓] or /water in manual
  // mode). Log it as a water event so trends keep tracking usage, and clear the
  // outstanding reminders.
  logManualWatering(ml: number): number {
    const actualMl = ml > 0 ? ml : this.manualWaterRecommendation();
    this.db.logEvent("water", { requestedMl: actualMl, actualMl, source: "manual" });
    this.pendingManualWaterMl.clear();
    this.log(`manual watering logged: ${actualMl} ml`);
    return actualMl;
  }

  // Per-pot one-liner from a verdict, e.g. "Pots: #1 basil vegetative 8/10 | ...".
  private plantsLine(v: Verdict): string {
    if (!v.plants.length) return "";
    return "Pots: " + v.plants.map((p) => `#${p.pot} ${p.species ?? "?"} ${p.stage} ${p.health}/10`).join(" | ");
  }

  // 14-day sparklines (health + water) and light-hours, with week-over-week
  // deltas in words. Shared by the daily report and the deep-review context.
  private trendSummary(days = 14): string {
    const health = this.db.healthSeries(days).map((h) => ({ ts: h.ts, value: h.score }));
    const water = this.db.waterSeries(days).map((w) => ({ ts: w.ts, value: w.ml }));
    const light = this.db.lightSeries(days);
    const healthDaily = dailyBuckets(health, days, "avg");
    const waterDaily = dailyBuckets(water, days, "sum");
    const lightHours = lightOnHoursByDay(light, days);
    const watts = this.db.wattsSeries(days).map((w) => ({ ts: w.ts, value: w.watts }));
    const lines = [
      `Health ${sparkline(healthDaily)} — ${describeDelta("health", weekOverWeek(health, "avg"))}`,
    ];
    // Per-unit health sparklines when the garden has more than one unit.
    const units = this.db.unitLabels(days);
    if (units.length > 1) {
      for (const u of units) {
        const hs = this.db.healthSeries(days, u).map((h) => ({ ts: h.ts, value: h.score }));
        lines.push(`  ${u.padEnd(8)} ${sparkline(dailyBuckets(hs, days, "avg"))}`);
      }
    }
    lines.push(
      `Water  ${sparkline(waterDaily)} — ${describeDelta("water", weekOverWeek(water, "sum"), { unit: "ml", digits: 0 })}`,
      `Light  ${sparkline(lightHours)} (hours/day)`,
    );
    if (watts.length) lines.push(`Pump W ${sparkline(dailyBuckets(watts, days, "avg"))} (draw per run)`);
    return lines.join("\n");
  }

  private buildReportText(): string {
    const perUnit = this.db.latestPerUnit();
    if (perUnit.length === 0) return "No analyses recorded yet.";
    const lines = [`🌿 Daily report`];
    if (perUnit.length > 1) {
      // Multi-unit: a health line per garden unit, newest first.
      lines.push("Units:");
      for (const r of perUnit) {
        lines.push(`• ${r.unit}: health ${r.verdict.healthScore}/10 — ${r.verdict.summary}`);
        if (r.verdict.issues.length) lines.push(`  issues: ${r.verdict.issues.join("; ")}`);
      }
    } else {
      const v = perUnit[0]!.verdict;
      const pots = this.plantsLine(v);
      lines.push(
        `Health: ${v.healthScore}/10`,
        v.summary,
        v.issues.length ? `Issues: ${v.issues.join("; ")}` : "No issues noted.",
        ...(pots ? [pots] : []),
      );
    }
    lines.push(
      "",
      this.trendSummary(14),
      this.hw.pump
        ? `Pump budget today: ${this.hw.pump.budgetUsedSeconds}s / ${this.hw.pump.budgetTotalSeconds}s`
        : "Watering: manual (add water when reminded)",
    );
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
      manual: this.isManual,
      pumpBudgetUsedSeconds: this.hw.pump?.budgetUsedSeconds ?? 0,
      pumpBudgetTotalSeconds: this.hw.pump?.budgetTotalSeconds ?? 0,
      pumpLocked: this.hw.pump?.isLocked ?? false,
      pumpLockReason: this.hw.pump?.isLocked ? this.hw.pump.lockoutReason : null,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      lastVerdict: last?.verdict ?? null,
      lastAnalysisTs: last?.ts ?? null,
    };
  }

  // Capture every camera now, tagged with its unit label (for labelled captions).
  async photoUnits(): Promise<{ label: string; path: string }[]> {
    const { captureUnits } = await import("./camera.ts");
    const units = await captureUnits(this.cfg);
    this.db.logEvent("photo", { count: units.length });
    return units;
  }

  async photoNow(): Promise<string[]> {
    return (await this.photoUnits()).map((u) => u.path);
  }

  // Manual watering. `override` bypasses a pump lockout (explicit owner intent);
  // the per-run/per-day caps still apply.
  async waterNow(ml: number, opts: { override?: boolean } = {}): Promise<number> {
    // Manual mode: there is no pump, so "watering" is logging that the owner
    // topped up by hand — keeps the water-usage trend intact.
    if (!this.hw.pump) return this.logManualWatering(ml);
    const actual = await this.hw.pump.waterMl(ml, opts.override ?? false);
    this.db.logEvent("water", { requestedMl: ml, actualMl: actual, source: opts.override ? "manual-override" : "manual" });
    if (actual > 0) this.evalPumpHealth(opts.override ? "manual-override" : "manual");
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
    await this.applyLight(desired);
  }

  async analyzeNow(unit?: string): Promise<UnitAnalysis[]> {
    this.lastAnalysisMs = Date.now();
    return this.runAnalysis(unit);
  }

  lastAnalysis(): Verdict | null {
    return this.db.lastAnalysis()?.verdict ?? null;
  }

  // The most recent verdict for each garden unit (newest unit first).
  unitSummaries(): { label: string; ts: string; verdict: Verdict }[] {
    return this.db.latestPerUnit().map((r) => ({ label: r.unit, ts: r.ts, verdict: r.verdict }));
  }

  reportText(): string {
    return this.buildReportText();
  }

  // --- weekly deep review --------------------------------------------------

  private buildDeepContext(): string {
    const j = this.db.journal(7);
    const notes = j
      .slice(-8)
      .map((r) => {
        const v = r.verdict;
        const pots = v.plants
          .map((p) => `#${p.pot} ${p.species ?? "?"} ${p.stage} ${p.health}/10${p.note ? ` (${p.note})` : ""}`)
          .join("; ");
        return `${r.ts} [${r.unit}]: health ${v.healthScore}/10 — ${v.summary}${pots ? ` | ${pots}` : ""}`;
      })
      .join("\n");
    const parts = [
      `Weekly deep review. ${j.length} analyses in the last 7 days.`,
      this.trendSummary(14),
      `Current settings: ${SETTABLE_KEYS.map((k) => `${k}=${effectiveValue(this.cfg, k)}`).join(", ")}`,
      `Recent per-analysis notes:\n${notes || "(none)"}`,
    ];
    // A/B: when the garden has more than one unit, spell out each unit's health
    // series and ask for a direct comparison.
    const units = this.db.unitLabels(14);
    if (units.length > 1) {
      const series = units
        .map((u) => `${u}: ${sparkline(this.db.healthSeries(14, u).map((h) => h.score))}`)
        .join("\n");
      parts.push(
        `This garden has ${units.length} units (${units.join(", ")}). Per-unit 14-day health:\n${series}\n` +
          `Compare the units directly: which is doing better or worse, and why (species, stage, light, water). ` +
          `Finish with a short A/B verdict paragraph.`,
      );
    }
    return parts.join("\n\n");
  }

  async runDeepReview(): Promise<DeepReview | null> {
    if (this.reviewing) return null;
    this.reviewing = true;
    try {
      const { listCameraFrames, sampleFrames } = await import("./timelapse.ts");
      // Sample a few frames from EACH unit's camera so the review sees them all.
      const devices = this.cfg.cameras.devices;
      const perUnit = devices.length > 1 ? Math.max(3, Math.floor(10 / devices.length)) : 10;
      const frames: string[] = [];
      for (let i = 0; i < devices.length; i++) {
        frames.push(...sampleFrames(await listCameraFrames(this.cfg, i, 7), perUnit));
      }
      const review = await this.brain.deepReview(frames, this.buildDeepContext());
      this.db.logEvent("deepReview", { recommendations: review.recommendations.length });
      this.log(`deep review: ${review.recommendations.length} recommendation(s)`);
      this.callbacks.onDeepReview?.({
        digest: review.digest,
        recommendations: review.recommendations,
        photo: frames[frames.length - 1],
      });
      return review;
    } catch (e) {
      this.log(`deep review error: ${e}`);
      this.db.logEvent("error", { where: "deepReview", message: String(e) });
      return null;
    } finally {
      this.reviewing = false;
    }
  }

  // --- remote tuning -------------------------------------------------------

  // Validate, persist, and hot-apply a settings change. Pump caps are re-applied
  // to the running Pump so a lowered cap takes effect immediately.
  setSetting(key: string, value: string | number): SetResult {
    const res = validateOverride(key, value, this.baseCaps);
    if (!res.ok || res.key === undefined || res.value === undefined) return res;
    this.overrides[res.key] = res.value;
    saveOverrides(this.cfg.dataDir, this.overrides);
    applyOverrides(this.cfg, this.overrides, this.baseCaps);
    this.hw.pump?.setCaps(this.cfg.pump.maxSecondsPerRun, this.cfg.pump.maxSecondsPerDay);
    this.db.logEvent("set", { key: res.key, value: res.value });
    this.log(`set ${res.key} = ${res.value}`);
    return res;
  }

  effectiveConfig(): { key: string; value: string | number }[] {
    return SETTABLE_KEYS.map((k) => ({ key: k, value: effectiveValue(this.cfg, k) }));
  }

  // --- conversation-facing read text (implements ConvController) -----------

  statusText(): string {
    const s = this.status();
    const lines = [
      `Light: ${s.lightOn ? "ON" : "OFF"}${s.override ? ` (override ${s.override.mode})` : ""}`,
      s.manual
        ? "Watering: manual (AI reminds you)"
        : `Pump budget: ${s.pumpBudgetUsedSeconds}s / ${s.pumpBudgetTotalSeconds}s today`,
      ...(s.pumpLocked ? [`⚠️ Pump LOCKED: ${s.pumpLockReason}`] : []),
      `Uptime: ${s.uptimeSeconds}s`,
    ];
    const units = this.unitSummaries();
    if (units.length > 1) {
      lines.push(`Units (${units.length}) — pump waters ${this.pumpUnit()}:`);
      for (const u of units) {
        lines.push(`• ${u.label}: health ${u.verdict.healthScore}/10 — ${u.verdict.summary}`);
      }
    } else if (s.lastVerdict) {
      lines.push(`Last check (${s.lastAnalysisTs}): health ${s.lastVerdict.healthScore}/10 — ${s.lastVerdict.summary}`);
      const p = this.plantsLine(s.lastVerdict);
      if (p) lines.push(p);
    } else {
      lines.push("No analysis yet.");
    }
    return lines.join("\n");
  }

  lastAnalysisText(): string {
    const v = this.lastAnalysis();
    if (!v) return "No analysis yet.";
    const lines = [
      `Health ${v.healthScore}/10 — ${v.summary}`,
      v.issues.length ? `Issues: ${v.issues.join("; ")}` : "No issues noted.",
    ];
    const p = this.plantsLine(v);
    if (p) lines.push(p);
    if (v.waterTopUpMl) lines.push(`Suggested top-up: ${v.waterTopUpMl} ml`);
    if (v.lightAdjustment !== "none") lines.push(`Light: ${v.lightAdjustment}`);
    return lines.join("\n");
  }

  historyText(days: number): string {
    const water = this.db.waterSeries(days);
    const totalMl = water.reduce((a, w) => a + w.ml, 0);
    const analyses = this.db.healthSeries(days).length;
    return [
      `Last ${days} day(s): ${analyses} analyses, ${water.length} waterings totalling ${totalMl.toFixed(0)} ml.`,
      this.trendSummary(Math.max(days, 14)),
    ].join("\n");
  }

  configText(): string {
    return this.effectiveConfig()
      .map((c) => `${c.key} = ${c.value}`)
      .join("\n");
  }
}

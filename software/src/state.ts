// Persistent state: a bun:sqlite database in cfg.dataDir.
//
// Tables:
//   events    (ts, kind, detail JSON)     — anything worth an audit trail
//   analyses  (ts, photoPaths, model, verdict JSON, raw text) — AI checks

import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { Verdict } from "./brain.ts";

export interface AnalysisRow {
  id: number;
  ts: string;
  unit: string; // garden unit label this analysis is for
  photoPaths: string[];
  model: string;
  verdict: Verdict;
  raw: string;
}

// Default unit label — the single-unit / legacy value. Kept in sync with the
// index-based label the first camera gets (see config.normalizeDevices).
export const DEFAULT_UNIT = "unit-1";

export interface EventRow {
  id: number;
  ts: string;
  kind: string;
  detail: unknown;
}

export class Db {
  private db: Database;

  constructor(cfg: Config) {
    this.db = new Database(join(cfg.dataDir, "samogrow.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        ts     TEXT NOT NULL,
        kind   TEXT NOT NULL,
        detail TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analyses (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ts         TEXT NOT NULL,
        unit       TEXT NOT NULL DEFAULT '${DEFAULT_UNIT}',
        photoPaths TEXT NOT NULL,
        model      TEXT NOT NULL,
        verdict    TEXT NOT NULL,
        raw        TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS journal (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        analysisId INTEGER NOT NULL,
        ts         TEXT NOT NULL,
        photoPath  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    // Migration: older DBs created before per-unit analysis have no `unit`
    // column. Add it (legacy rows default to the single-unit label).
    const cols = this.db.query("PRAGMA table_info(analyses)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "unit")) {
      this.db.exec(`ALTER TABLE analyses ADD COLUMN unit TEXT NOT NULL DEFAULT '${DEFAULT_UNIT}';`);
    }
  }

  // --- small key/value store (survives restarts) ---------------------------

  setKv(key: string, value: unknown): void {
    this.db
      .query("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  getKv<T>(key: string): T | null {
    const row = this.db.query("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | null;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  // Pump lockout state, persisted so a lockout survives a service restart.
  setPumpLock(locked: boolean, reason: string): void {
    this.setKv("pumpLock", { locked, reason });
  }
  getPumpLock(): { locked: boolean; reason: string } | null {
    return this.getKv<{ locked: boolean; reason: string }>("pumpLock");
  }

  logEvent(kind: string, detail: unknown = {}): void {
    this.db
      .query("INSERT INTO events (ts, kind, detail) VALUES (?, ?, ?)")
      .run(new Date().toISOString(), kind, JSON.stringify(detail));
  }

  saveAnalysis(a: { unit?: string; photoPaths: string[]; model: string; verdict: Verdict; raw: string }): void {
    const ts = new Date().toISOString();
    const unit = a.unit ?? DEFAULT_UNIT;
    const res = this.db
      .query("INSERT INTO analyses (ts, unit, photoPaths, model, verdict, raw) VALUES (?, ?, ?, ?, ?, ?)")
      .run(ts, unit, JSON.stringify(a.photoPaths), a.model, JSON.stringify(a.verdict), a.raw);
    // Journal: one row per photo, linking it to this analysis (growth journal).
    const analysisId = Number(res.lastInsertRowid);
    const ins = this.db.query("INSERT INTO journal (analysisId, ts, photoPath) VALUES (?, ?, ?)");
    for (const p of a.photoPaths) ins.run(analysisId, ts, p);
  }

  lastAnalysis(): AnalysisRow | null {
    const row = this.db
      .query("SELECT * FROM analyses ORDER BY id DESC LIMIT 1")
      .get() as Record<string, unknown> | null;
    return row ? this.toAnalysis(row) : null;
  }

  recentAnalyses(limit = 20): AnalysisRow[] {
    const rows = this.db
      .query("SELECT * FROM analyses ORDER BY id DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.toAnalysis(r));
  }

  recentEvents(limit = 20): EventRow[] {
    const rows = this.db
      .query("SELECT * FROM events ORDER BY id DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      kind: r.kind as string,
      detail: JSON.parse(r.detail as string),
    }));
  }

  // Seconds the last top-up event was recorded, expressed as hours since now.
  // Returns null if there has never been one.
  hoursSinceLastTopUp(): number | null {
    const row = this.db
      .query("SELECT ts FROM events WHERE kind = 'water' ORDER BY id DESC LIMIT 1")
      .get() as { ts: string } | null;
    if (!row) return null;
    return (Date.now() - new Date(row.ts).getTime()) / 3_600_000;
  }

  // --- trends --------------------------------------------------------------

  private sinceIso(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString();
  }

  // Health score per analysis over the last N days (chronological). Pass a unit
  // label to restrict to one garden unit; omit (or "all") for the whole-garden
  // rollup across every unit.
  healthSeries(days: number, unit?: string): { ts: string; score: number }[] {
    const perUnit = unit !== undefined && unit !== "all";
    const sql = perUnit
      ? "SELECT ts, verdict FROM analyses WHERE ts >= ? AND unit = ? ORDER BY id ASC"
      : "SELECT ts, verdict FROM analyses WHERE ts >= ? ORDER BY id ASC";
    const rows = (
      perUnit ? this.db.query(sql).all(this.sinceIso(days), unit) : this.db.query(sql).all(this.sinceIso(days))
    ) as { ts: string; verdict: string }[];
    return rows.map((r) => ({ ts: r.ts, score: (JSON.parse(r.verdict) as Verdict).healthScore }));
  }

  // Distinct garden-unit labels seen in analyses over the last N days, in the
  // order they first appeared.
  unitLabels(days: number): string[] {
    const rows = this.db
      .query("SELECT unit, MIN(id) AS firstId FROM analyses WHERE ts >= ? GROUP BY unit ORDER BY firstId ASC")
      .all(this.sinceIso(days)) as { unit: string }[];
    return rows.map((r) => r.unit);
  }

  // The most recent analysis for each garden unit (one row per unit), newest
  // unit first.
  latestPerUnit(): AnalysisRow[] {
    const rows = this.db
      .query(
        "SELECT * FROM analyses WHERE id IN (SELECT MAX(id) FROM analyses GROUP BY unit) ORDER BY id DESC",
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.toAnalysis(r));
  }

  // Water top-ups (actual ml dispensed) over the last N days.
  waterSeries(days: number): { ts: string; ml: number }[] {
    const rows = this.db
      .query("SELECT ts, detail FROM events WHERE kind = 'water' AND ts >= ? ORDER BY id ASC")
      .all(this.sinceIso(days)) as { ts: string; detail: string }[];
    return rows.map((r) => {
      const d = JSON.parse(r.detail) as { actualMl?: number };
      return { ts: r.ts, ml: typeof d.actualMl === "number" ? d.actualMl : 0 };
    });
  }

  // Sampled pump power draw per run over the last N days.
  wattsSeries(days: number): { ts: string; watts: number }[] {
    const rows = this.db
      .query("SELECT ts, detail FROM events WHERE kind = 'pumpRun' AND ts >= ? ORDER BY id ASC")
      .all(this.sinceIso(days)) as { ts: string; detail: string }[];
    return rows
      .map((r) => JSON.parse(r.detail) as { watts?: number; ts?: string })
      .map((d, i) => ({ ts: rows[i]!.ts, watts: typeof d.watts === "number" ? d.watts : 0 }));
  }

  // Light on/off transitions over the last N days.
  lightSeries(days: number): { ts: string; on: boolean }[] {
    const rows = this.db
      .query("SELECT ts, detail FROM events WHERE kind = 'light' AND ts >= ? ORDER BY id ASC")
      .all(this.sinceIso(days)) as { ts: string; detail: string }[];
    return rows.map((r) => {
      const d = JSON.parse(r.detail) as { state?: string };
      return { ts: r.ts, on: d.state === "on" };
    });
  }

  // Analyses (with photos + verdict) over the last N days — the growth journal,
  // used to build the weekly deep-review context.
  journal(days: number): AnalysisRow[] {
    const rows = this.db
      .query("SELECT * FROM analyses WHERE ts >= ? ORDER BY id ASC")
      .all(this.sinceIso(days)) as Record<string, unknown>[];
    return rows.map((r) => this.toAnalysis(r));
  }

  close(): void {
    this.db.close();
  }

  private toAnalysis(r: Record<string, unknown>): AnalysisRow {
    return {
      id: r.id as number,
      ts: r.ts as string,
      unit: (r.unit as string | undefined) ?? DEFAULT_UNIT,
      photoPaths: JSON.parse(r.photoPaths as string),
      model: r.model as string,
      verdict: JSON.parse(r.verdict as string),
      raw: r.raw as string,
    };
  }
}

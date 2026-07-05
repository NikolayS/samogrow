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
  photoPaths: string[];
  model: string;
  verdict: Verdict;
  raw: string;
}

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
        photoPaths TEXT NOT NULL,
        model      TEXT NOT NULL,
        verdict    TEXT NOT NULL,
        raw        TEXT NOT NULL
      );
    `);
  }

  logEvent(kind: string, detail: unknown = {}): void {
    this.db
      .query("INSERT INTO events (ts, kind, detail) VALUES (?, ?, ?)")
      .run(new Date().toISOString(), kind, JSON.stringify(detail));
  }

  saveAnalysis(a: { photoPaths: string[]; model: string; verdict: Verdict; raw: string }): void {
    this.db
      .query("INSERT INTO analyses (ts, photoPaths, model, verdict, raw) VALUES (?, ?, ?, ?, ?)")
      .run(
        new Date().toISOString(),
        JSON.stringify(a.photoPaths),
        a.model,
        JSON.stringify(a.verdict),
        a.raw,
      );
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

  close(): void {
    this.db.close();
  }

  private toAnalysis(r: Record<string, unknown>): AnalysisRow {
    return {
      id: r.id as number,
      ts: r.ts as string,
      photoPaths: JSON.parse(r.photoPaths as string),
      model: r.model as string,
      verdict: JSON.parse(r.verdict as string),
      raw: r.raw as string,
    };
  }
}

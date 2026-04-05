// ─── Cost Tracker ────────────────────────────────────────────────────────────
// Ported from AgentManager/src/cost-tracker.ts — uses Bun's native SQLite

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CostRecord {
  agentId: string;
  agentName: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  estimatedCost: number;
  createdAt: string;
  closedAt: string | null;
}

export interface CostHistorySummary {
  allTimeCost: number;
  allTimeTokensIn: number;
  allTimeTokensOut: number;
  totalRecords: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DB_PATH = join(HEYHANK_HOME, "costs.db");

// ─── CostTracker ─────────────────────────────────────────────────────────────

export class CostTracker {
  private db: Database;

  constructor() {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA synchronous=NORMAL");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cost_records (
        agent_id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        estimated_cost REAL DEFAULT 0,
        created_at TEXT NOT NULL,
        closed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /** Insert or update a cost record. */
  upsert(record: CostRecord): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO cost_records (agent_id, agent_name, model, tokens_in, tokens_out, estimated_cost, created_at, closed_at)
        VALUES ($agentId, $agentName, $model, $tokensIn, $tokensOut, $estimatedCost, $createdAt, $closedAt)
        ON CONFLICT(agent_id) DO UPDATE SET
          agent_name = $agentName,
          model = $model,
          tokens_in = $tokensIn,
          tokens_out = $tokensOut,
          estimated_cost = $estimatedCost,
          closed_at = $closedAt
      `);
      stmt.run({
        $agentId: record.agentId,
        $agentName: record.agentName,
        $model: record.model,
        $tokensIn: record.tokensIn,
        $tokensOut: record.tokensOut,
        $estimatedCost: record.estimatedCost,
        $createdAt: record.createdAt,
        $closedAt: record.closedAt,
      });
    } catch (err) {
      console.warn("[cost-tracker] upsert failed:", err);
    }
  }

  /** Mark a record as closed (agent destroyed). */
  finalize(agentId: string): void {
    try {
      this.db
        .prepare("UPDATE cost_records SET closed_at = $closedAt WHERE agent_id = $agentId")
        .run({
          $closedAt: new Date().toISOString(),
          $agentId: agentId,
        });
    } catch (err) {
      console.warn("[cost-tracker] finalize failed:", err);
    }
  }

  /** Get all records, newest first. */
  getAll(limit = 500): CostRecord[] {
    try {
      const rows = this.db
        .prepare(
          "SELECT agent_id, agent_name, model, tokens_in, tokens_out, estimated_cost, created_at, closed_at FROM cost_records ORDER BY created_at DESC LIMIT ?",
        )
        .all(limit) as Array<{
        agent_id: string;
        agent_name: string;
        model: string;
        tokens_in: number;
        tokens_out: number;
        estimated_cost: number;
        created_at: string;
        closed_at: string | null;
      }>;
      return rows.map((r) => ({
        agentId: r.agent_id,
        agentName: r.agent_name,
        model: r.model,
        tokensIn: r.tokens_in,
        tokensOut: r.tokens_out,
        estimatedCost: r.estimated_cost,
        createdAt: r.created_at,
        closedAt: r.closed_at,
      }));
    } catch (err) {
      console.warn("[cost-tracker] getAll failed:", err);
      return [];
    }
  }

  /** Get aggregate summary. */
  getSummary(): CostHistorySummary {
    try {
      const row = this.db
        .prepare(
          "SELECT COALESCE(SUM(estimated_cost),0) as total_cost, COALESCE(SUM(tokens_in),0) as total_in, COALESCE(SUM(tokens_out),0) as total_out, COUNT(*) as cnt FROM cost_records",
        )
        .get() as {
        total_cost: number;
        total_in: number;
        total_out: number;
        cnt: number;
      };
      return {
        allTimeCost: row.total_cost,
        allTimeTokensIn: row.total_in,
        allTimeTokensOut: row.total_out,
        totalRecords: row.cnt,
      };
    } catch (err) {
      console.warn("[cost-tracker] getSummary failed:", err);
      return {
        allTimeCost: 0,
        allTimeTokensIn: 0,
        allTimeTokensOut: 0,
        totalRecords: 0,
      };
    }
  }

  /** Delete all cost records. Returns number deleted. */
  reset(): number {
    try {
      const result = this.db.prepare("DELETE FROM cost_records").run();
      return result.changes;
    } catch (err) {
      console.warn("[cost-tracker] reset failed:", err);
      return 0;
    }
  }

  /** Get spend limit. */
  getSpendLimit(): number | null {
    try {
      const row = this.db
        .prepare("SELECT value FROM settings WHERE key = 'spend_limit'")
        .get() as { value: string } | undefined;
      return row ? parseFloat(row.value) : null;
    } catch {
      return null;
    }
  }

  /** Set or clear spend limit. */
  setSpendLimit(limit: number | null): void {
    try {
      if (limit === null) {
        this.db.prepare("DELETE FROM settings WHERE key = 'spend_limit'").run();
      } else {
        this.db
          .prepare(
            "INSERT INTO settings (key, value) VALUES ('spend_limit', $val) ON CONFLICT(key) DO UPDATE SET value = $val",
          )
          .run({ $val: String(limit) });
      }
    } catch (err) {
      console.warn("[cost-tracker] setSpendLimit failed:", err);
    }
  }

  /** Close the database connection. */
  close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore
    }
  }
}

/** Singleton instance */
export const costTracker = new CostTracker();

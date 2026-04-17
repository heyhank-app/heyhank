import { join } from "path";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { atomicWriteFileSync } from "../fs-utils.js";

export interface KPIValue {
  value: number;
  date: string;
  note?: string;
}

export interface KPI {
  id: string;
  name: string;
  description?: string;
  unit: string; // %, EUR, count, hours, etc.
  category: string; // revenue, growth, operations, marketing, custom
  target?: number;
  warningThreshold?: number; // below this = yellow
  criticalThreshold?: number; // below this = red
  direction: "up" | "down"; // up = higher is better, down = lower is better
  currentValue?: number;
  previousValue?: number;
  trend?: "up" | "down" | "stable";
  trendPercent?: number;
  history: KPIValue[];
  createdAt: string;
  updatedAt: string;
}

export interface KPIDashboard {
  kpis: KPI[];
  lastUpdated: string;
  summary: {
    total: number;
    onTarget: number;
    warning: number;
    critical: number;
    noData: number;
  };
}

const DATA_DIR = join(process.env.HEYHANK_HOME || join(process.env.HOME || "/root", ".heyhank"), "kpi");
const KPI_FILE = join(DATA_DIR, "kpis.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function load(): KPI[] {
  ensureDir();
  if (!existsSync(KPI_FILE)) return [];
  try { return JSON.parse(readFileSync(KPI_FILE, "utf-8")); }
  catch { return []; }
}

function save(kpis: KPI[]) {
  ensureDir();
  atomicWriteFileSync(KPI_FILE, JSON.stringify(kpis, null, 2));
}

function calculateTrend(history: KPIValue[]): { trend: "up" | "down" | "stable"; percent: number } {
  if (history.length < 2) return { trend: "stable", percent: 0 };
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  const current = sorted[0].value;
  const previous = sorted[1].value;
  if (previous === 0) return { trend: current > 0 ? "up" : "stable", percent: 0 };
  const percent = Math.round(((current - previous) / Math.abs(previous)) * 100 * 10) / 10;
  return {
    trend: percent > 1 ? "up" : percent < -1 ? "down" : "stable",
    percent
  };
}

function getStatus(kpi: KPI): "on-target" | "warning" | "critical" | "no-data" {
  if (kpi.currentValue === undefined) return "no-data";
  if (kpi.target === undefined) return "on-target";

  const ratio = kpi.direction === "up"
    ? kpi.currentValue / kpi.target
    : kpi.target / kpi.currentValue;

  if (kpi.criticalThreshold !== undefined && ratio < kpi.criticalThreshold / 100) return "critical";
  if (kpi.warningThreshold !== undefined && ratio < kpi.warningThreshold / 100) return "warning";
  return ratio >= 1 ? "on-target" : "warning";
}

export function defineKPI(name: string, unit: string, category: string, opts?: { description?: string; target?: number; direction?: "up" | "down"; warningThreshold?: number; criticalThreshold?: number }): KPI {
  const kpis = load();
  const kpi: KPI = {
    id: randomUUID(),
    name,
    description: opts?.description,
    unit,
    category,
    target: opts?.target,
    warningThreshold: opts?.warningThreshold || 80,
    criticalThreshold: opts?.criticalThreshold || 50,
    direction: opts?.direction || "up",
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  kpis.push(kpi);
  save(kpis);
  return kpi;
}

export function recordValue(kpiId: string, value: number, date?: string, note?: string): KPI | null {
  const kpis = load();
  const idx = kpis.findIndex(k => k.id === kpiId);
  if (idx === -1) return null;

  const entry: KPIValue = {
    value,
    date: date || new Date().toISOString().slice(0, 10),
    note
  };

  kpis[idx].history.push(entry);
  kpis[idx].history.sort((a, b) => b.date.localeCompare(a.date));

  // Keep max 365 entries
  if (kpis[idx].history.length > 365) kpis[idx].history = kpis[idx].history.slice(0, 365);

  // Update current/previous
  kpis[idx].previousValue = kpis[idx].currentValue;
  kpis[idx].currentValue = value;

  // Calculate trend
  const { trend, percent } = calculateTrend(kpis[idx].history);
  kpis[idx].trend = trend;
  kpis[idx].trendPercent = percent;
  kpis[idx].updatedAt = new Date().toISOString();

  save(kpis);
  return kpis[idx];
}

export function getKPI(id: string): KPI | null {
  return load().find(k => k.id === id) || null;
}

export function listKPIs(category?: string): KPI[] {
  let kpis = load();
  if (category) kpis = kpis.filter(k => k.category === category);
  return kpis;
}

export function updateKPI(id: string, patch: Partial<Pick<KPI, "name" | "description" | "unit" | "category" | "target" | "direction" | "warningThreshold" | "criticalThreshold">>): KPI | null {
  const kpis = load();
  const idx = kpis.findIndex(k => k.id === id);
  if (idx === -1) return null;
  Object.assign(kpis[idx], patch);
  kpis[idx].updatedAt = new Date().toISOString();
  save(kpis);
  return kpis[idx];
}

export function deleteKPI(id: string): boolean {
  const kpis = load();
  const idx = kpis.findIndex(k => k.id === id);
  if (idx === -1) return false;
  kpis.splice(idx, 1);
  save(kpis);
  return true;
}

export function getDashboard(): KPIDashboard {
  const kpis = load();
  let onTarget = 0, warning = 0, critical = 0, noData = 0;

  for (const kpi of kpis) {
    const status = getStatus(kpi);
    if (status === "on-target") onTarget++;
    else if (status === "warning") warning++;
    else if (status === "critical") critical++;
    else noData++;
  }

  return {
    kpis,
    lastUpdated: new Date().toISOString(),
    summary: { total: kpis.length, onTarget, warning, critical, noData }
  };
}

export function getKPIHistory(id: string, period?: "week" | "month" | "quarter" | "year"): KPIValue[] {
  const kpi = getKPI(id);
  if (!kpi) return [];

  if (!period) return kpi.history;

  const now = new Date();
  let cutoff: Date;
  switch (period) {
    case "week": cutoff = new Date(now.getTime() - 7 * 86400000); break;
    case "month": cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); break;
    case "quarter": cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
    case "year": cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
  }

  return kpi.history.filter(v => v.date >= cutoff.toISOString().slice(0, 10));
}

export function listCategories(): string[] {
  return [...new Set(load().map(k => k.category))].sort();
}

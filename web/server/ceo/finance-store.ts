import { join } from "path";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { atomicWriteFileSync } from "../fs-utils.js";

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail?: string;
  clientAddress?: string;
  items: InvoiceItem[];
  subtotal: number;
  taxRate: number; // percentage
  taxAmount: number;
  total: number;
  currency: string;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled";
  issueDate: string;
  dueDate: string;
  paidDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  project?: string;
  vendor?: string;
  receipt?: string; // file reference
  recurring: boolean;
  notes?: string;
  createdAt: string;
}

export interface FinancialSummary {
  period: string;
  startDate: string;
  endDate: string;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  currency: string;
  invoicesByStatus: Record<string, { count: number; total: number }>;
  expensesByCategory: Record<string, number>;
  revenueByMonth: Record<string, number>;
  expensesByMonth: Record<string, number>;
  outstandingInvoices: Invoice[];
}

const DATA_DIR = join(process.env.HEYHANK_HOME || join(process.env.HOME || "/root", ".heyhank"), "finance");
const INVOICES_FILE = join(DATA_DIR, "invoices.json");
const EXPENSES_FILE = join(DATA_DIR, "expenses.json");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadInvoices(): Invoice[] {
  ensureDir();
  if (!existsSync(INVOICES_FILE)) return [];
  try { return JSON.parse(readFileSync(INVOICES_FILE, "utf-8")); }
  catch { return []; }
}

function saveInvoices(invoices: Invoice[]) {
  ensureDir();
  atomicWriteFileSync(INVOICES_FILE, JSON.stringify(invoices, null, 2));
}

function loadExpenses(): Expense[] {
  ensureDir();
  if (!existsSync(EXPENSES_FILE)) return [];
  try { return JSON.parse(readFileSync(EXPENSES_FILE, "utf-8")); }
  catch { return []; }
}

function saveExpenses(expenses: Expense[]) {
  ensureDir();
  atomicWriteFileSync(EXPENSES_FILE, JSON.stringify(expenses, null, 2));
}

interface FinanceSettings {
  defaultCurrency: string;
  defaultTaxRate: number;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  companyName?: string;
  companyAddress?: string;
  companyEmail?: string;
  bankDetails?: string;
}

function loadSettings(): FinanceSettings {
  ensureDir();
  if (!existsSync(SETTINGS_FILE)) {
    return { defaultCurrency: "EUR", defaultTaxRate: 20, invoicePrefix: "INV", nextInvoiceNumber: 1 };
  }
  try { return JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")); }
  catch { return { defaultCurrency: "EUR", defaultTaxRate: 20, invoicePrefix: "INV", nextInvoiceNumber: 1 }; }
}

function saveSettings(settings: FinanceSettings) {
  ensureDir();
  atomicWriteFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function generateInvoiceNumber(): string {
  const settings = loadSettings();
  const num = `${settings.invoicePrefix}-${String(settings.nextInvoiceNumber).padStart(4, "0")}`;
  settings.nextInvoiceNumber++;
  saveSettings(settings);
  return num;
}

// Invoices
export function createInvoice(clientName: string, items: InvoiceItem[], opts?: { clientEmail?: string; clientAddress?: string; taxRate?: number; currency?: string; dueDate?: string; notes?: string }): Invoice {
  const invoices = loadInvoices();
  const settings = loadSettings();
  const taxRate = opts?.taxRate ?? settings.defaultTaxRate;
  const subtotal = items.reduce((sum, i) => sum + i.total, 0);
  const taxAmount = Math.round(subtotal * taxRate / 100 * 100) / 100;

  const invoice: Invoice = {
    id: randomUUID(),
    invoiceNumber: generateInvoiceNumber(),
    clientName,
    clientEmail: opts?.clientEmail,
    clientAddress: opts?.clientAddress,
    items,
    subtotal,
    taxRate,
    taxAmount,
    total: subtotal + taxAmount,
    currency: opts?.currency || settings.defaultCurrency,
    status: "draft",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: opts?.dueDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    notes: opts?.notes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  invoices.push(invoice);
  saveInvoices(invoices);
  return invoice;
}

export function listInvoices(status?: string, startDate?: string, endDate?: string): Invoice[] {
  let invoices = loadInvoices();
  if (status) invoices = invoices.filter(i => i.status === status);
  if (startDate) invoices = invoices.filter(i => i.issueDate >= startDate);
  if (endDate) invoices = invoices.filter(i => i.issueDate <= endDate);
  return invoices.sort((a, b) => b.issueDate.localeCompare(a.issueDate));
}

export function getInvoice(id: string): Invoice | null {
  return loadInvoices().find(i => i.id === id) || null;
}

export function updateInvoice(id: string, patch: Partial<Pick<Invoice, "status" | "clientName" | "clientEmail" | "clientAddress" | "items" | "notes" | "dueDate" | "paidDate">>): Invoice | null {
  const invoices = loadInvoices();
  const idx = invoices.findIndex(i => i.id === id);
  if (idx === -1) return null;

  if (patch.items) {
    const subtotal = patch.items.reduce((sum, i) => sum + i.total, 0);
    invoices[idx].items = patch.items;
    invoices[idx].subtotal = subtotal;
    invoices[idx].taxAmount = Math.round(subtotal * invoices[idx].taxRate / 100 * 100) / 100;
    invoices[idx].total = subtotal + invoices[idx].taxAmount;
  }
  if (patch.status !== undefined) invoices[idx].status = patch.status;
  if (patch.clientName !== undefined) invoices[idx].clientName = patch.clientName;
  if (patch.clientEmail !== undefined) invoices[idx].clientEmail = patch.clientEmail;
  if (patch.clientAddress !== undefined) invoices[idx].clientAddress = patch.clientAddress;
  if (patch.notes !== undefined) invoices[idx].notes = patch.notes;
  if (patch.dueDate !== undefined) invoices[idx].dueDate = patch.dueDate;
  if (patch.paidDate !== undefined) invoices[idx].paidDate = patch.paidDate;
  invoices[idx].updatedAt = new Date().toISOString();

  saveInvoices(invoices);
  return invoices[idx];
}

export function markPaid(id: string): Invoice | null {
  return updateInvoice(id, { status: "paid", paidDate: new Date().toISOString().slice(0, 10) });
}

export function deleteInvoice(id: string): boolean {
  const invoices = loadInvoices();
  const idx = invoices.findIndex(i => i.id === id);
  if (idx === -1) return false;
  invoices.splice(idx, 1);
  saveInvoices(invoices);
  return true;
}

// Expenses
export function logExpense(description: string, amount: number, category: string, opts?: { currency?: string; date?: string; project?: string; vendor?: string; recurring?: boolean; notes?: string }): Expense {
  const expenses = loadExpenses();
  const settings = loadSettings();
  const expense: Expense = {
    id: randomUUID(),
    description,
    amount,
    currency: opts?.currency || settings.defaultCurrency,
    category,
    date: opts?.date || new Date().toISOString().slice(0, 10),
    project: opts?.project,
    vendor: opts?.vendor,
    recurring: opts?.recurring || false,
    notes: opts?.notes,
    createdAt: new Date().toISOString()
  };
  expenses.unshift(expense);
  saveExpenses(expenses);
  return expense;
}

export function listExpenses(category?: string, startDate?: string, endDate?: string): Expense[] {
  let expenses = loadExpenses();
  if (category) expenses = expenses.filter(e => e.category === category);
  if (startDate) expenses = expenses.filter(e => e.date >= startDate);
  if (endDate) expenses = expenses.filter(e => e.date <= endDate);
  return expenses.sort((a, b) => b.date.localeCompare(a.date));
}

export function deleteExpense(id: string): boolean {
  const expenses = loadExpenses();
  const idx = expenses.findIndex(e => e.id === id);
  if (idx === -1) return false;
  expenses.splice(idx, 1);
  saveExpenses(expenses);
  return true;
}

// Financial Summary
export function getFinancialSummary(period: "month" | "quarter" | "year" | "custom", startDate?: string, endDate?: string): FinancialSummary {
  const now = new Date();
  let start: Date;
  let end: Date = now;

  switch (period) {
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "quarter":
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), qMonth, 1);
      break;
    case "year":
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case "custom":
      start = startDate ? new Date(startDate) : new Date(now.getFullYear(), 0, 1);
      end = endDate ? new Date(endDate) : now;
      break;
  }

  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  const invoices = listInvoices(undefined, startStr, endStr);
  const expenses = listExpenses(undefined, startStr, endStr);

  const invoicesByStatus: Record<string, { count: number; total: number }> = {};
  let totalRevenue = 0;
  const revenueByMonth: Record<string, number> = {};
  const outstandingInvoices: Invoice[] = [];

  for (const inv of invoices) {
    if (!invoicesByStatus[inv.status]) invoicesByStatus[inv.status] = { count: 0, total: 0 };
    invoicesByStatus[inv.status].count++;
    invoicesByStatus[inv.status].total += inv.total;

    if (inv.status === "paid") {
      totalRevenue += inv.total;
      const month = inv.issueDate.slice(0, 7);
      revenueByMonth[month] = (revenueByMonth[month] || 0) + inv.total;
    }
    if (inv.status === "sent" || inv.status === "overdue") {
      outstandingInvoices.push(inv);
    }
  }

  const expensesByCategory: Record<string, number> = {};
  const expensesByMonth: Record<string, number> = {};
  let totalExpenses = 0;

  for (const exp of expenses) {
    totalExpenses += exp.amount;
    expensesByCategory[exp.category] = (expensesByCategory[exp.category] || 0) + exp.amount;
    const month = exp.date.slice(0, 7);
    expensesByMonth[month] = (expensesByMonth[month] || 0) + exp.amount;
  }

  const settings = loadSettings();

  return {
    period,
    startDate: startStr,
    endDate: endStr,
    totalRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    currency: settings.defaultCurrency,
    invoicesByStatus,
    expensesByCategory,
    revenueByMonth,
    expensesByMonth,
    outstandingInvoices
  };
}

export function getFinanceSettings(): FinanceSettings {
  return loadSettings();
}

export function updateFinanceSettings(patch: Partial<FinanceSettings>): FinanceSettings {
  const settings = loadSettings();
  Object.assign(settings, patch);
  saveSettings(settings);
  return settings;
}

export function listExpenseCategories(): string[] {
  return [...new Set(loadExpenses().map(e => e.category))].sort();
}

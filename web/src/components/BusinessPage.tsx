// ─── Business Page ──────────────────────────────────────────────────────────
// Finance + KPI Dashboard for HeyHank.

import { useState, useEffect, useCallback } from "react";
import { financeApi, kpiApi } from "../api.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  total: number;
  currency: string;
  status: string;
  issueDate: string;
  dueDate: string;
  paidDate?: string;
}

interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface Expense {
  id: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  vendor?: string;
  project?: string;
}

interface FinanceSummary {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  currency: string;
  invoicesByStatus: Record<string, { count: number; total: number }>;
  outstandingInvoices: Array<{ id: string; invoiceNumber: string; clientName: string; total: number; dueDate: string }>;
}

interface Kpi {
  id: string;
  name: string;
  unit: string;
  category: string;
  target?: number;
  currentValue?: number;
  trend?: string;
  trendPercent?: number;
  direction: string;
}

interface KpiDashboardSummary {
  total: number;
  onTarget: number;
  warning: number;
  critical: number;
  noData: number;
}

type TabId = "finance" | "kpis";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "draft": return "bg-gray-500/20 text-gray-400";
    case "sent": return "bg-blue-500/20 text-blue-400";
    case "paid": return "bg-green-500/20 text-green-400";
    case "overdue": return "bg-red-500/20 text-red-400";
    default: return "bg-cc-hover text-cc-muted";
  }
}

function trendArrow(trend?: string): string {
  if (trend === "up") return "\u2191";
  if (trend === "down") return "\u2193";
  return "\u2192";
}

function trendColor(trend?: string, direction?: string): string {
  if (!trend || trend === "stable") return "text-cc-muted";
  const good = (trend === "up" && direction === "higher_is_better") || (trend === "down" && direction === "lower_is_better");
  return good ? "text-green-400" : "text-red-400";
}

function kpiStatusColor(kpi: Kpi): "green" | "yellow" | "red" | "gray" {
  if (kpi.currentValue == null || kpi.target == null) return "gray";
  const ratio = kpi.direction === "lower_is_better"
    ? kpi.target / kpi.currentValue
    : kpi.currentValue / kpi.target;
  if (ratio >= 0.9) return "green";
  if (ratio >= 0.7) return "yellow";
  return "red";
}

function progressPercent(kpi: Kpi): number {
  if (kpi.currentValue == null || kpi.target == null || kpi.target === 0) return 0;
  const raw = kpi.direction === "lower_is_better"
    ? (kpi.target / Math.max(kpi.currentValue, 0.001)) * 100
    : (kpi.currentValue / kpi.target) * 100;
  return Math.min(Math.max(raw, 0), 100);
}

// ─── Finance Tab ────────────────────────────────────────────────────────────

function FinanceTab() {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Invoice form
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceClient, setInvoiceClient] = useState("");
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([{ description: "", quantity: 1, unitPrice: 0, total: 0 }]);
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [invoiceSaving, setInvoiceSaving] = useState(false);

  // Expense form
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  const [expenseVendor, setExpenseVendor] = useState("");
  const [expenseSaving, setExpenseSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryRes, invoicesRes, expensesRes] = await Promise.all([
        financeApi.summary(),
        financeApi.listInvoices(),
        financeApi.listExpenses(),
      ]);
      setSummary(summaryRes);
      setInvoices(invoicesRes.invoices);
      setExpenses(expensesRes.expenses);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load finance data");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const updateItem = (index: number, field: keyof InvoiceItem, value: string) => {
    setInvoiceItems(prev => {
      const next = [...prev];
      const item = { ...next[index] };
      if (field === "description") {
        item.description = value;
      } else {
        const num = parseFloat(value) || 0;
        if (field === "quantity") item.quantity = num;
        if (field === "unitPrice") item.unitPrice = num;
      }
      item.total = item.quantity * item.unitPrice;
      next[index] = item;
      return next;
    });
  };

  const addItem = () => {
    setInvoiceItems(prev => [...prev, { description: "", quantity: 1, unitPrice: 0, total: 0 }]);
  };

  const removeItem = (index: number) => {
    setInvoiceItems(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index));
  };

  const createInvoice = async () => {
    if (!invoiceClient.trim() || invoiceItems.every(i => !i.description.trim())) return;
    setInvoiceSaving(true);
    try {
      const items = invoiceItems.filter(i => i.description.trim()).map(i => ({
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        total: i.quantity * i.unitPrice,
      }));
      await financeApi.createInvoice({
        clientName: invoiceClient.trim(),
        items,
        notes: invoiceNotes.trim() || undefined,
      });
      setShowInvoiceForm(false);
      setInvoiceClient("");
      setInvoiceItems([{ description: "", quantity: 1, unitPrice: 0, total: 0 }]);
      setInvoiceNotes("");
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    }
    setInvoiceSaving(false);
  };

  const markPaid = async (id: string) => {
    try {
      await financeApi.markPaid(id);
      loadData();
    } catch { /* ignore */ }
  };

  const deleteInvoice = async (id: string) => {
    try {
      await financeApi.deleteInvoice(id);
      setInvoices(prev => prev.filter(inv => inv.id !== id));
    } catch { /* ignore */ }
  };

  const logExpense = async () => {
    if (!expenseDesc.trim() || !expenseAmount) return;
    setExpenseSaving(true);
    try {
      await financeApi.logExpense({
        description: expenseDesc.trim(),
        amount: parseFloat(expenseAmount),
        category: expenseCategory.trim() || "general",
        vendor: expenseVendor.trim() || undefined,
      });
      setShowExpenseForm(false);
      setExpenseDesc("");
      setExpenseAmount("");
      setExpenseCategory("");
      setExpenseVendor("");
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log expense");
    }
    setExpenseSaving(false);
  };

  const deleteExpense = async (id: string) => {
    try {
      await financeApi.deleteExpense(id);
      setExpenses(prev => prev.filter(e => e.id !== id));
    } catch { /* ignore */ }
  };

  if (loading) {
    return <p className="text-sm text-cc-muted py-8 text-center">Loading finance data...</p>;
  }

  if (error && !summary) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-red-400">{error}</p>
        <button type="button" onClick={loadData} className="mt-2 text-xs text-cc-accent hover:underline">Retry</button>
      </div>
    );
  }

  const cur = summary?.currency || "EUR";

  return (
    <div className="space-y-6">
      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
          <button type="button" onClick={() => setError("")} className="ml-2 text-xs underline">dismiss</button>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-cc-border bg-cc-card p-4">
            <p className="text-xs text-cc-muted uppercase tracking-wider">Revenue</p>
            <p className="text-xl font-semibold text-green-400 mt-1">{formatCurrency(summary.totalRevenue, cur)}</p>
          </div>
          <div className="rounded-lg border border-cc-border bg-cc-card p-4">
            <p className="text-xs text-cc-muted uppercase tracking-wider">Expenses</p>
            <p className="text-xl font-semibold text-red-400 mt-1">{formatCurrency(summary.totalExpenses, cur)}</p>
          </div>
          <div className="rounded-lg border border-cc-border bg-cc-card p-4">
            <p className="text-xs text-cc-muted uppercase tracking-wider">Profit</p>
            <p className={`text-xl font-semibold mt-1 ${summary.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
              {formatCurrency(summary.netProfit, cur)}
            </p>
          </div>
        </div>
      )}

      {/* Invoices section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-cc-fg">Invoices</h2>
          <button
            type="button"
            onClick={() => setShowInvoiceForm(!showInvoiceForm)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 transition-colors"
          >
            {showInvoiceForm ? "Cancel" : "+ New Invoice"}
          </button>
        </div>

        {/* Create invoice form */}
        {showInvoiceForm && (
          <div className="rounded-lg border border-cc-border bg-cc-card p-4 mb-4 space-y-3">
            <input
              type="text"
              value={invoiceClient}
              onChange={e => setInvoiceClient(e.target.value)}
              placeholder="Client name"
              className="w-full px-3 py-2 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
            />
            <div className="space-y-2">
              <p className="text-xs text-cc-muted font-medium">Line items</p>
              {invoiceItems.map((item, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={item.description}
                    onChange={e => updateItem(i, "description", e.target.value)}
                    placeholder="Description"
                    className="flex-1 px-2 py-1.5 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
                  />
                  <input
                    type="number"
                    value={item.quantity || ""}
                    onChange={e => updateItem(i, "quantity", e.target.value)}
                    placeholder="Qty"
                    min="1"
                    className="w-16 px-2 py-1.5 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
                  />
                  <input
                    type="number"
                    value={item.unitPrice || ""}
                    onChange={e => updateItem(i, "unitPrice", e.target.value)}
                    placeholder="Price"
                    min="0"
                    step="0.01"
                    className="w-24 px-2 py-1.5 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
                  />
                  <span className="text-xs text-cc-muted w-20 text-right">{formatCurrency(item.quantity * item.unitPrice, cur)}</span>
                  {invoiceItems.length > 1 && (
                    <button type="button" onClick={() => removeItem(i)} className="text-cc-muted hover:text-red-400 p-1 transition-colors">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={addItem} className="text-xs text-cc-accent hover:underline">+ Add item</button>
            </div>
            <textarea
              value={invoiceNotes}
              onChange={e => setInvoiceNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full px-3 py-2 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent resize-none"
            />
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-cc-fg">
                Total: {formatCurrency(invoiceItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0), cur)}
              </p>
              <button
                type="button"
                onClick={createInvoice}
                disabled={invoiceSaving || !invoiceClient.trim()}
                className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-40 transition-colors"
              >
                {invoiceSaving ? "Creating..." : "Create Invoice"}
              </button>
            </div>
          </div>
        )}

        {/* Invoice list */}
        {invoices.length === 0 ? (
          <p className="text-sm text-cc-muted py-4 text-center">No invoices yet</p>
        ) : (
          <div className="space-y-2">
            {invoices.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-cc-border bg-cc-card group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-cc-fg">{inv.invoiceNumber}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusColor(inv.status)}`}>
                      {inv.status}
                    </span>
                  </div>
                  <p className="text-xs text-cc-muted mt-0.5">
                    {inv.clientName} &middot; {formatCurrency(inv.total, inv.currency)} &middot; Due {new Date(inv.dueDate).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {inv.status !== "paid" && (
                    <button
                      type="button"
                      onClick={() => markPaid(inv.id)}
                      className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                      title="Mark as paid"
                    >
                      Paid
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteInvoice(inv.id)}
                    className="text-cc-muted hover:text-red-400 p-1 transition-colors"
                    title="Delete invoice"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Expenses section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-cc-fg">Expenses</h2>
          <button
            type="button"
            onClick={() => setShowExpenseForm(!showExpenseForm)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 transition-colors"
          >
            {showExpenseForm ? "Cancel" : "+ Log Expense"}
          </button>
        </div>

        {/* Log expense form */}
        {showExpenseForm && (
          <div className="rounded-lg border border-cc-border bg-cc-card p-4 mb-4 space-y-3">
            <input
              type="text"
              value={expenseDesc}
              onChange={e => setExpenseDesc(e.target.value)}
              placeholder="Description"
              className="w-full px-3 py-2 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                value={expenseAmount}
                onChange={e => setExpenseAmount(e.target.value)}
                placeholder="Amount"
                min="0"
                step="0.01"
                className="px-3 py-2 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
              />
              <input
                type="text"
                value={expenseCategory}
                onChange={e => setExpenseCategory(e.target.value)}
                placeholder="Category (e.g. hosting, marketing)"
                className="px-3 py-2 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
              />
            </div>
            <input
              type="text"
              value={expenseVendor}
              onChange={e => setExpenseVendor(e.target.value)}
              placeholder="Vendor (optional)"
              className="w-full px-3 py-2 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={logExpense}
                disabled={expenseSaving || !expenseDesc.trim() || !expenseAmount}
                className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-40 transition-colors"
              >
                {expenseSaving ? "Saving..." : "Log Expense"}
              </button>
            </div>
          </div>
        )}

        {/* Expense list */}
        {expenses.length === 0 ? (
          <p className="text-sm text-cc-muted py-4 text-center">No expenses logged</p>
        ) : (
          <div className="space-y-2">
            {expenses.map(exp => (
              <div key={exp.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-cc-border bg-cc-card group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-cc-fg">{exp.description}</p>
                  <p className="text-xs text-cc-muted mt-0.5">
                    {formatCurrency(exp.amount, exp.currency)} &middot; {exp.category}
                    {exp.vendor && <> &middot; {exp.vendor}</>}
                    {" "}&middot; {new Date(exp.date).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteExpense(exp.id)}
                  className="text-cc-muted hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-all"
                  title="Delete expense"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPIs Tab ───────────────────────────────────────────────────────────────

function KPIsTab() {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [dashSummary, setDashSummary] = useState<KpiDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Define KPI form
  const [showDefineForm, setShowDefineForm] = useState(false);
  const [kpiName, setKpiName] = useState("");
  const [kpiUnit, setKpiUnit] = useState("");
  const [kpiCategory, setKpiCategory] = useState("");
  const [kpiTarget, setKpiTarget] = useState("");
  const [kpiDirection, setKpiDirection] = useState("higher_is_better");
  const [kpiSaving, setKpiSaving] = useState(false);

  // Record value
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordValue, setRecordValue] = useState("");
  const [recordSaving, setRecordSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await kpiApi.dashboard();
      setKpis(res.kpis);
      setDashSummary(res.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load KPI data");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const defineKpi = async () => {
    if (!kpiName.trim() || !kpiUnit.trim() || !kpiCategory.trim()) return;
    setKpiSaving(true);
    try {
      await kpiApi.define({
        name: kpiName.trim(),
        unit: kpiUnit.trim(),
        category: kpiCategory.trim(),
        target: kpiTarget ? parseFloat(kpiTarget) : undefined,
        direction: kpiDirection,
      });
      setShowDefineForm(false);
      setKpiName("");
      setKpiUnit("");
      setKpiCategory("");
      setKpiTarget("");
      setKpiDirection("higher_is_better");
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to define KPI");
    }
    setKpiSaving(false);
  };

  const submitRecord = async () => {
    if (!recordingId || !recordValue) return;
    setRecordSaving(true);
    try {
      await kpiApi.record(recordingId, parseFloat(recordValue));
      setRecordingId(null);
      setRecordValue("");
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record value");
    }
    setRecordSaving(false);
  };

  const deleteKpi = async (id: string) => {
    try {
      await kpiApi.delete(id);
      setKpis(prev => prev.filter(k => k.id !== id));
    } catch { /* ignore */ }
  };

  if (loading) {
    return <p className="text-sm text-cc-muted py-8 text-center">Loading KPI data...</p>;
  }

  if (error && !dashSummary) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-red-400">{error}</p>
        <button type="button" onClick={loadData} className="mt-2 text-xs text-cc-accent hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
          <button type="button" onClick={() => setError("")} className="ml-2 text-xs underline">dismiss</button>
        </div>
      )}

      {/* Dashboard summary */}
      {dashSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-cc-border bg-cc-card p-4 text-center">
            <p className="text-2xl font-semibold text-green-400">{dashSummary.onTarget}</p>
            <p className="text-xs text-cc-muted mt-1">On Target</p>
          </div>
          <div className="rounded-lg border border-cc-border bg-cc-card p-4 text-center">
            <p className="text-2xl font-semibold text-yellow-400">{dashSummary.warning}</p>
            <p className="text-xs text-cc-muted mt-1">Warning</p>
          </div>
          <div className="rounded-lg border border-cc-border bg-cc-card p-4 text-center">
            <p className="text-2xl font-semibold text-red-400">{dashSummary.critical}</p>
            <p className="text-xs text-cc-muted mt-1">Critical</p>
          </div>
          <div className="rounded-lg border border-cc-border bg-cc-card p-4 text-center">
            <p className="text-2xl font-semibold text-cc-muted">{dashSummary.noData}</p>
            <p className="text-xs text-cc-muted mt-1">No Data</p>
          </div>
        </div>
      )}

      {/* Define KPI button + form */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-cc-fg">KPIs</h2>
          <button
            type="button"
            onClick={() => setShowDefineForm(!showDefineForm)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 transition-colors"
          >
            {showDefineForm ? "Cancel" : "+ Define KPI"}
          </button>
        </div>

        {showDefineForm && (
          <div className="rounded-lg border border-cc-border bg-cc-card p-4 mb-4 space-y-3">
            <input
              type="text"
              value={kpiName}
              onChange={e => setKpiName(e.target.value)}
              placeholder="KPI Name (e.g. Monthly Revenue)"
              className="w-full px-3 py-2 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={kpiUnit}
                onChange={e => setKpiUnit(e.target.value)}
                placeholder="Unit (e.g. EUR, %, users)"
                className="px-3 py-2 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
              />
              <input
                type="text"
                value={kpiCategory}
                onChange={e => setKpiCategory(e.target.value)}
                placeholder="Category (e.g. finance, growth)"
                className="px-3 py-2 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                value={kpiTarget}
                onChange={e => setKpiTarget(e.target.value)}
                placeholder="Target (optional)"
                min="0"
                step="any"
                className="px-3 py-2 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
              />
              <select
                value={kpiDirection}
                onChange={e => setKpiDirection(e.target.value)}
                className="px-3 py-2 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg focus:outline-none focus:ring-1 focus:ring-cc-accent"
              >
                <option value="higher_is_better">Higher is better</option>
                <option value="lower_is_better">Lower is better</option>
              </select>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={defineKpi}
                disabled={kpiSaving || !kpiName.trim() || !kpiUnit.trim() || !kpiCategory.trim()}
                className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-40 transition-colors"
              >
                {kpiSaving ? "Saving..." : "Define KPI"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* KPI grid */}
      {kpis.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-cc-muted">No KPIs defined yet</p>
          <p className="text-xs text-cc-muted/70 mt-1">Click "Define KPI" to create your first metric.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {kpis.map(kpi => {
            const color = kpiStatusColor(kpi);
            const progress = progressPercent(kpi);
            const barColor = color === "green" ? "bg-green-500" : color === "yellow" ? "bg-yellow-500" : color === "red" ? "bg-red-500" : "bg-cc-muted/30";

            return (
              <div
                key={kpi.id}
                className="rounded-lg border border-cc-border bg-cc-card p-4 group cursor-pointer hover:border-cc-accent/40 transition-colors"
                onClick={() => {
                  if (recordingId === kpi.id) return;
                  setRecordingId(kpi.id);
                  setRecordValue("");
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-cc-fg truncate">{kpi.name}</p>
                    <p className="text-xs text-cc-muted mt-0.5">{kpi.category}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-lg font-semibold ${trendColor(kpi.trend, kpi.direction)}`}>
                      {trendArrow(kpi.trend)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); deleteKpi(kpi.id); }}
                      className="text-cc-muted hover:text-red-400 p-0.5 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete KPI"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <span className="text-2xl font-semibold text-cc-fg">
                    {kpi.currentValue != null ? kpi.currentValue : "--"}
                  </span>
                  <span className="text-xs text-cc-muted ml-1">{kpi.unit}</span>
                  {kpi.trendPercent != null && (
                    <span className={`text-xs ml-2 ${trendColor(kpi.trend, kpi.direction)}`}>
                      {kpi.trendPercent > 0 ? "+" : ""}{kpi.trendPercent.toFixed(1)}%
                    </span>
                  )}
                </div>

                {kpi.target != null && (
                  <div className="mt-3">
                    <div className="flex justify-between text-[10px] text-cc-muted mb-1">
                      <span>Progress</span>
                      <span>Target: {kpi.target} {kpi.unit}</span>
                    </div>
                    <div className="w-full h-1.5 bg-cc-hover rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}

                {/* Record value inline */}
                {recordingId === kpi.id && (
                  <div className="mt-3 pt-3 border-t border-cc-border" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={recordValue}
                        onChange={e => setRecordValue(e.target.value)}
                        placeholder={`New value (${kpi.unit})`}
                        step="any"
                        autoFocus
                        className="flex-1 px-2 py-1.5 text-sm bg-cc-bg rounded-md border border-cc-border text-cc-fg placeholder:text-cc-muted/60 focus:outline-none focus:ring-1 focus:ring-cc-accent"
                        onKeyDown={e => {
                          if (e.key === "Enter") submitRecord();
                          if (e.key === "Escape") { setRecordingId(null); setRecordValue(""); }
                        }}
                      />
                      <button
                        type="button"
                        onClick={submitRecord}
                        disabled={recordSaving || !recordValue}
                        className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-40 transition-colors"
                      >
                        {recordSaving ? "..." : "Record"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRecordingId(null); setRecordValue(""); }}
                        className="px-2 py-1.5 text-xs rounded-md text-cc-muted hover:text-cc-fg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function BusinessPage({ embedded }: { embedded?: boolean }) {
  const [tab, setTab] = useState<TabId>("finance");

  const tabs: { id: TabId; label: string }[] = [
    { id: "finance", label: "Finance" },
    { id: "kpis", label: "KPIs" },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-cc-bg">
      {/* Header with tabs */}
      <div className="border-b border-cc-border px-4 sm:px-8 pt-4 pb-0">
        <h1 className="text-lg font-semibold text-cc-fg">Business</h1>
        <p className="text-xs text-cc-muted mt-1">Finance overview and KPI tracking.</p>
        <div className="flex gap-1 mt-3">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
                tab === t.id
                  ? "bg-cc-bg text-cc-fg border border-cc-border border-b-cc-bg -mb-px"
                  : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto w-full px-4 sm:px-8 py-6">
          {tab === "finance" && <FinanceTab />}
          {tab === "kpis" && <KPIsTab />}
        </div>
      </div>
    </div>
  );
}

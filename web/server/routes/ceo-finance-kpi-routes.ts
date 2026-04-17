import { Hono } from "hono";
import * as financeStore from "../ceo/finance-store.js";
import * as kpiStore from "../ceo/kpi-store.js";

export function registerCeoFinanceKpiRoutes(api: Hono) {
  // === INVOICES ===
  api.get("/assistant/invoices", (c) => {
    const status = c.req.query("status") || undefined;
    const start = c.req.query("start") || undefined;
    const end = c.req.query("end") || undefined;
    return c.json({ invoices: financeStore.listInvoices(status, start, end) });
  });

  api.post("/assistant/invoices", async (c) => {
    const body = await c.req.json();
    if (!body.clientName || !body.items?.length) {
      return c.json({ error: "clientName and items are required" }, 400);
    }
    const invoice = financeStore.createInvoice(body.clientName, body.items, {
      clientEmail: body.clientEmail,
      clientAddress: body.clientAddress,
      taxRate: body.taxRate,
      currency: body.currency,
      dueDate: body.dueDate,
      notes: body.notes
    });
    return c.json(invoice, 201);
  });

  api.get("/assistant/invoices/:id", (c) => {
    const invoice = financeStore.getInvoice(c.req.param("id"));
    if (!invoice) return c.json({ error: "not found" }, 404);
    return c.json(invoice);
  });

  api.patch("/assistant/invoices/:id", async (c) => {
    const body = await c.req.json();
    const invoice = financeStore.updateInvoice(c.req.param("id"), body);
    if (!invoice) return c.json({ error: "not found" }, 404);
    return c.json(invoice);
  });

  api.post("/assistant/invoices/:id/paid", (c) => {
    const invoice = financeStore.markPaid(c.req.param("id"));
    if (!invoice) return c.json({ error: "not found" }, 404);
    return c.json(invoice);
  });

  api.delete("/assistant/invoices/:id", (c) => {
    const ok = financeStore.deleteInvoice(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ success: true });
  });

  // === EXPENSES ===
  api.get("/assistant/expenses", (c) => {
    const category = c.req.query("category") || undefined;
    const start = c.req.query("start") || undefined;
    const end = c.req.query("end") || undefined;
    return c.json({ expenses: financeStore.listExpenses(category, start, end) });
  });

  api.post("/assistant/expenses", async (c) => {
    const body = await c.req.json();
    if (!body.description || body.amount === undefined || !body.category) {
      return c.json({ error: "description, amount, and category are required" }, 400);
    }
    const expense = financeStore.logExpense(body.description, body.amount, body.category, {
      currency: body.currency,
      date: body.date,
      project: body.project,
      vendor: body.vendor,
      recurring: body.recurring,
      notes: body.notes
    });
    return c.json(expense, 201);
  });

  api.delete("/assistant/expenses/:id", (c) => {
    const ok = financeStore.deleteExpense(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ success: true });
  });

  api.get("/assistant/expenses/categories", (c) => {
    return c.json({ categories: financeStore.listExpenseCategories() });
  });

  // === FINANCIAL SUMMARY ===
  api.get("/assistant/finance/summary", (c) => {
    const period = (c.req.query("period") || "month") as "month" | "quarter" | "year" | "custom";
    const start = c.req.query("start") || undefined;
    const end = c.req.query("end") || undefined;
    return c.json(financeStore.getFinancialSummary(period, start, end));
  });

  api.get("/assistant/finance/settings", (c) => {
    return c.json(financeStore.getFinanceSettings());
  });

  api.patch("/assistant/finance/settings", async (c) => {
    const body = await c.req.json();
    return c.json(financeStore.updateFinanceSettings(body));
  });

  // === KPI ===
  api.get("/assistant/kpis", (c) => {
    const category = c.req.query("category") || undefined;
    return c.json({ kpis: kpiStore.listKPIs(category) });
  });

  api.get("/assistant/kpis/dashboard", (c) => {
    return c.json(kpiStore.getDashboard());
  });

  api.get("/assistant/kpis/categories", (c) => {
    return c.json({ categories: kpiStore.listCategories() });
  });

  api.post("/assistant/kpis", async (c) => {
    const body = await c.req.json();
    if (!body.name || !body.unit || !body.category) {
      return c.json({ error: "name, unit, and category are required" }, 400);
    }
    const kpi = kpiStore.defineKPI(body.name, body.unit, body.category, {
      description: body.description,
      target: body.target,
      direction: body.direction,
      warningThreshold: body.warningThreshold,
      criticalThreshold: body.criticalThreshold
    });
    return c.json(kpi, 201);
  });

  api.get("/assistant/kpis/:id", (c) => {
    const kpi = kpiStore.getKPI(c.req.param("id"));
    if (!kpi) return c.json({ error: "not found" }, 404);
    return c.json(kpi);
  });

  api.patch("/assistant/kpis/:id", async (c) => {
    const body = await c.req.json();
    const kpi = kpiStore.updateKPI(c.req.param("id"), body);
    if (!kpi) return c.json({ error: "not found" }, 404);
    return c.json(kpi);
  });

  api.post("/assistant/kpis/:id/record", async (c) => {
    const body = await c.req.json();
    if (body.value === undefined) return c.json({ error: "value is required" }, 400);
    const kpi = kpiStore.recordValue(c.req.param("id"), body.value, body.date, body.note);
    if (!kpi) return c.json({ error: "not found" }, 404);
    return c.json(kpi);
  });

  api.get("/assistant/kpis/:id/history", (c) => {
    const period = c.req.query("period") as "week" | "month" | "quarter" | "year" | undefined;
    const history = kpiStore.getKPIHistory(c.req.param("id"), period);
    return c.json({ history });
  });

  api.delete("/assistant/kpis/:id", (c) => {
    const ok = kpiStore.deleteKPI(c.req.param("id"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ success: true });
  });
}

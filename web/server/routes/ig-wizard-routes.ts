// Instagram Wizard HTTP route. Thin wrapper around the shared generation
// logic in `../ig-wizard.ts` — kept tiny so the same code path can also be
// used by the MCP server (web/server/mcp/ig-wizard-mcp-server.ts).

import type { Hono } from "hono";
import { generateIgWizard, normalizeLanguage, normalizeNiche } from "../ig-wizard.js";

export function registerIgWizardRoutes(api: Hono): void {
  api.post("/ig-wizard/generate", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { niche?: unknown; language?: unknown };
    const niche = normalizeNiche(body.niche);
    const lang = normalizeLanguage(body.language);

    const res = await generateIgWizard(niche, lang);
    if (!res.ok) return c.json({ error: res.error }, res.status);
    return c.json(res.result);
  });
}

import type { Hono } from "hono";
import {
  BUILTIN_SOURCES,
  getSource,
  installSkill,
  isValidSlug,
  listSkills,
  readInstalledMeta,
} from "../marketplace.js";

export function registerMarketplaceRoutes(api: Hono): void {
  // List all configured marketplace sources.
  api.get("/marketplace/sources", (c) => {
    return c.json(
      BUILTIN_SOURCES.map((s) => ({
        id: s.id,
        name: s.name,
        owner: s.owner,
        url: s.url,
        description: s.description ?? "",
      })),
    );
  });

  // List skills available in a given source (live fetch from GitHub).
  api.get("/marketplace/sources/:id/skills", async (c) => {
    const source = getSource(c.req.param("id"));
    if (!source) return c.json({ error: "Source not found" }, 404);
    try {
      const skills = await listSkills(source);
      return c.json(skills);
    } catch (e) {
      return c.json({ error: String(e instanceof Error ? e.message : e) }, 502);
    }
  });

  // Install a skill from a source into ~/.claude/skills/<slug>/.
  api.post("/marketplace/install", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
    const slug = typeof body.slug === "string" ? body.slug : "";
    const overwrite = body.overwrite === true;
    const source = getSource(sourceId);
    if (!source) return c.json({ error: "Source not found" }, 404);
    if (!isValidSlug(slug)) return c.json({ error: "Invalid slug" }, 400);
    try {
      const result = await installSkill(source, slug, { overwrite });
      return c.json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = /already installed/i.test(msg) ? 409 : 500;
      return c.json({ error: msg }, status);
    }
  });

  // Returns marketplace metadata for an installed skill (or null if not from a marketplace).
  api.get("/marketplace/installed/:slug", async (c) => {
    const slug = c.req.param("slug");
    if (!isValidSlug(slug)) return c.json({ error: "Invalid slug" }, 400);
    const meta = await readInstalledMeta(slug);
    return c.json(meta ?? null);
  });
}

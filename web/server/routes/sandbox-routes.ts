import type { Hono } from "hono";
import * as sandboxManager from "../sandbox-manager.js";
import { containerManager } from "../container-manager.js";

export function registerSandboxRoutes(
  api: Hono,
): void {
  api.get("/sandboxes", (c) => {
    try {
      return c.json(sandboxManager.listSandboxes());
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  api.get("/sandboxes/:slug", (c) => {
    const sandbox = sandboxManager.getSandbox(c.req.param("slug"));
    if (!sandbox) return c.json({ error: "Sandbox not found" }, 404);
    return c.json(sandbox);
  });

  api.post("/sandboxes", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const sandbox = sandboxManager.createSandbox(body.name, {
        dockerfile: body.dockerfile,
        initScript: body.initScript,
      });
      return c.json(sandbox, 201);
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  api.put("/sandboxes/:slug", async (c) => {
    const slug = c.req.param("slug");
    const body = await c.req.json().catch(() => ({}));
    try {
      const sandbox = sandboxManager.updateSandbox(slug, {
        name: body.name,
        dockerfile: body.dockerfile,
        initScript: body.initScript,
        imageTag: body.imageTag,
      });
      if (!sandbox) return c.json({ error: "Sandbox not found" }, 404);
      return c.json(sandbox);
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  api.delete("/sandboxes/:slug", (c) => {
    try {
      const deleted = sandboxManager.deleteSandbox(c.req.param("slug"));
      if (!deleted) return c.json({ error: "Sandbox not found" }, 404);
      return c.json({ ok: true });
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

  api.post("/sandboxes/:slug/build", async (c) => {
    const slug = c.req.param("slug");
    const sandbox = sandboxManager.getSandbox(slug);
    if (!sandbox) return c.json({ error: "Sandbox not found" }, 404);
    if (!sandbox.dockerfile) return c.json({ error: "No Dockerfile configured for this sandbox" }, 400);
    if (!containerManager.checkDocker()) return c.json({ error: "Docker is not available" }, 503);

    const tag = `companion-sandbox-${slug}:latest`;
    sandboxManager.updateBuildStatus(slug, "building");

    try {
      const result = await containerManager.buildImageStreaming(sandbox.dockerfile, tag);
      if (result.success) {
        sandboxManager.updateBuildStatus(slug, "success", { imageTag: tag });
        return c.json({ success: true, imageTag: tag, log: result.log });
      } else {
        sandboxManager.updateBuildStatus(slug, "error", { error: result.log.slice(-500) });
        return c.json({ success: false, log: result.log }, 500);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      sandboxManager.updateBuildStatus(slug, "error", { error: msg });
      return c.json({ success: false, error: msg }, 500);
    }
  });

  api.get("/sandboxes/:slug/build-status", (c) => {
    const sandbox = sandboxManager.getSandbox(c.req.param("slug"));
    if (!sandbox) return c.json({ error: "Sandbox not found" }, 404);
    return c.json({
      buildStatus: sandbox.buildStatus || "idle",
      buildError: sandbox.buildError,
      lastBuiltAt: sandbox.lastBuiltAt,
      imageTag: sandbox.imageTag,
    });
  });
}

import type { Hono } from "hono";
import { getTailscaleStatus, startFunnel, stopFunnel } from "../tailscale-manager.js";

export function registerTailscaleRoutes(api: Hono, port: number): void {
  api.get("/tailscale/status", async (c) => {
    const status = await getTailscaleStatus(port);
    return c.json(status);
  });

  api.post("/tailscale/funnel/start", async (c) => {
    const status = await startFunnel(port);
    if (status.error) {
      return c.json(status, 503);
    }
    return c.json(status);
  });

  api.post("/tailscale/funnel/stop", async (c) => {
    const status = await stopFunnel(port);
    if (status.error) {
      return c.json(status, 503);
    }
    return c.json(status);
  });
}

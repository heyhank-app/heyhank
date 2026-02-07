process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { createRoutes } from "./routes.js";
import { ControllerBridge } from "./controller-bridge.js";
import type { ServerWebSocket } from "bun";

const bridge = new ControllerBridge();
const app = new Hono();

app.use("/api/*", cors());
app.route("/api", createRoutes(bridge));

// In production, serve built frontend
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("/*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT) || 3456;

const server = Bun.serve({
  port,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Hono handles the rest
    return app.fetch(req, server);
  },
  websocket: {
    open(ws: ServerWebSocket<unknown>) {
      bridge.ws.add(ws);
      // Send snapshot
      bridge.ws.sendTo(ws, {
        type: "snapshot",
        session: bridge.sessionInfo,
        agents: bridge.getAgents(),
        messages: bridge.getMessages(),
        pendingApprovals: bridge.getPendingApprovals(),
      });
    },
    message(_ws: ServerWebSocket<unknown>, _msg: string | Buffer) {
      // Client doesn't send WS messages, all actions via REST
    },
    close(ws: ServerWebSocket<unknown>) {
      bridge.ws.remove(ws);
    },
  },
});

console.log(`Server running on http://localhost:${server.port}`);

// In dev mode, log that Vite should be run separately
if (process.env.NODE_ENV !== "production") {
  console.log("Dev mode: run 'bun run dev:vite' in another terminal for the frontend");
}

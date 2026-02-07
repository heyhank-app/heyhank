import type { ServerWebSocket } from "bun";
import type { WsEvent } from "./types.js";

export class WsManager {
  private clients = new Set<ServerWebSocket<unknown>>();

  add(ws: ServerWebSocket<unknown>) {
    this.clients.add(ws);
  }

  remove(ws: ServerWebSocket<unknown>) {
    this.clients.delete(ws);
  }

  get size() {
    return this.clients.size;
  }

  broadcast(event: WsEvent) {
    const data = JSON.stringify(event);
    for (const ws of this.clients) {
      try {
        ws.send(data);
      } catch {
        this.clients.delete(ws);
      }
    }
  }

  sendTo(ws: ServerWebSocket<unknown>, event: WsEvent) {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      this.clients.delete(ws);
    }
  }
}

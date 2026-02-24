#!/usr/bin/env node
"use strict";

// Bridges newline-delimited JSON on stdin/stdout to WebSocket text frames for
// Codex app-server. Runs in real Node (not Bun) so the `ws` package handles the
// Codex Rust server handshake correctly with perMessageDeflate disabled.

const readline = require("node:readline");
const WebSocket = require("ws");

const url = process.argv[2];
const timeoutMs = Number(process.argv[3] || "10000");

if (!url) {
  process.stderr.write("[codex-ws-proxy] Missing URL argument\n");
  process.exit(2);
}

let ws = null;
let opened = false;
let closed = false;
let exiting = false;
let queue = [];
let connectAttempt = 0;
const startedAt = Date.now();

function log(msg) {
  process.stderr.write(`[codex-ws-proxy] ${msg}\n`);
}

function decodeMessageData(data) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data.map((x) => Buffer.from(x))).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data);
}

function flushQueue() {
  if (!ws || ws.readyState !== WebSocket.OPEN || queue.length === 0) return;
  for (const line of queue) {
    ws.send(line);
  }
  queue = [];
}

function failAndExit(message, code = 1) {
  if (exiting) return;
  exiting = true;
  log(message);
  try { if (ws) ws.close(); } catch {}
  process.exit(code);
}

function connect() {
  if (closed || exiting) return;
  connectAttempt += 1;
  const elapsed = Date.now() - startedAt;
  if (!opened && elapsed > timeoutMs) {
    failAndExit(`Failed to connect within ${timeoutMs}ms`);
    return;
  }

  ws = new WebSocket(url, { perMessageDeflate: false });

  ws.once("open", () => {
    opened = true;
    flushQueue();
  });

  ws.on("message", (data) => {
    const raw = decodeMessageData(data);
    // stdout is protocol channel: ONLY write payload lines
    process.stdout.write(raw + "\n");
  });

  ws.once("close", (code, reason) => {
    if (closed || exiting) return;
    const why = reason ? ` reason=${reason}` : "";
    // If connection closes before we ever opened, keep retrying until timeout.
    if (!opened) {
      setTimeout(connect, Math.min(100 * connectAttempt, 500));
      return;
    }
    failAndExit(`WebSocket closed (code=${code}${why})`);
  });

  ws.once("error", (err) => {
    if (closed || exiting) return;
    // Retry during startup; after a successful connection, surface and exit.
    if (!opened) {
      setTimeout(connect, Math.min(100 * connectAttempt, 500));
      return;
    }
    failAndExit(`WebSocket error: ${err && err.message ? err.message : String(err)}`);
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  if (closed || exiting) return;
  if (!line) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    queue.push(line);
    return;
  }
  ws.send(line);
});

rl.on("close", () => {
  closed = true;
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  } catch {}
  process.exit(0);
});

process.on("SIGINT", () => {
  closed = true;
  try { if (ws) ws.close(); } catch {}
  process.exit(0);
});

process.on("SIGTERM", () => {
  closed = true;
  try { if (ws) ws.close(); } catch {}
  process.exit(0);
});

connect();

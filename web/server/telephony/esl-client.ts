// ─── FreeSWITCH ESL TCP Client ───────────────────────────────────────────────
// Lightweight ESL (Event Socket Layer) client for sending commands to FreeSWITCH.
// Uses TCP socket protocol (mod_event_socket) instead of HTTP (mod_xml_rpc).
//
// Protocol: Connect → receive "Content-Type: auth/request" → send "auth <pw>" →
// receive "Reply-Text: +OK" → send "api <cmd>" → read response.

import { connect, type Socket } from "node:net";
import type { FreeSwitchConfig } from "./call-types.js";

/**
 * Send a single FreeSWITCH API command via ESL TCP and return the response.
 * Opens a connection, authenticates, sends the command, then closes.
 * Use background=true for long-running commands like originate (uses bgapi).
 */
export async function eslCommand(
  command: string,
  config: FreeSwitchConfig,
  timeoutMs = 5000,
  background = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let authenticated = false;
    let commandSent = false;
    let responseBody = "";
    let expectedContentLength = 0;
    let resolved = false;

    const done = (result: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const fail = (err: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(new Error(`ESL timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const socket: Socket = connect(config.eslPort, config.eslHost, () => {
      // Connection established — wait for auth/request
    });

    socket.setEncoding("utf-8");

    socket.on("data", (chunk: string) => {
      buffer += chunk;

      // Parse ESL protocol messages (header + body separated by \n\n)
      while (buffer.includes("\n\n")) {
        const delimIdx = buffer.indexOf("\n\n");
        const block = buffer.slice(0, delimIdx);
        buffer = buffer.slice(delimIdx + 2);

        const headers = parseHeaders(block);

        if (!authenticated) {
          if (headers["Content-Type"] === "auth/request") {
            socket.write(`auth ${config.eslPassword}\n\n`);
          } else if (headers["Reply-Text"]?.startsWith("+OK")) {
            authenticated = true;
            // Use bgapi for background commands (non-blocking), api for regular
            const prefix = background ? "bgapi" : "api";
            socket.write(`${prefix} ${command}\n\n`);
            commandSent = true;
          } else if (headers["Reply-Text"]?.startsWith("-ERR")) {
            fail(new Error(`ESL auth failed: ${headers["Reply-Text"]}`));
            return;
          }
        } else if (commandSent) {
          // bgapi returns Reply-Text with Job-UUID immediately
          if (background && headers["Reply-Text"]) {
            const reply = headers["Reply-Text"];
            if (reply.startsWith("+OK")) {
              // Extract Job-UUID: "+OK Job-UUID: xxxx"
              const jobId = reply.replace("+OK Job-UUID: ", "").trim();
              done(jobId || "+OK");
              return;
            } else if (reply.startsWith("-ERR")) {
              fail(new Error(`FreeSWITCH error: ${reply}`));
              return;
            }
          }

          // Regular api response
          if (headers["Content-Type"] === "api/response") {
            expectedContentLength = parseInt(headers["Content-Length"] || "0", 10);
            if (expectedContentLength > 0) {
              if (buffer.length >= expectedContentLength) {
                done(buffer.slice(0, expectedContentLength));
                return;
              }
              // Wait for more data
            } else {
              done("");
              return;
            }
          }
        }
      }

      // If we're waiting for body content after headers
      if (expectedContentLength > 0 && buffer.length >= expectedContentLength) {
        done(buffer.slice(0, expectedContentLength));
      }
    });

    socket.on("error", (err) => {
      fail(new Error(`ESL connection error: ${err.message}`));
    });

    socket.on("close", () => {
      if (!resolved && !commandSent) {
        fail(new Error("ESL connection closed before command sent"));
      }
    });
  });
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(": ");
    if (idx > 0) {
      headers[line.slice(0, idx)] = line.slice(idx + 2);
    }
  }
  return headers;
}

/**
 * Subscribe to FreeSWITCH events for inbound call detection + hangup cleanup.
 * Maintains a persistent ESL connection that listens for CHANNEL_CREATE and
 * CHANNEL_HANGUP_COMPLETE events. Auto-reconnects on disconnect.
 */
export function eslSubscribe(
  config: FreeSwitchConfig,
  onInboundCall: (info: { uuid: string; callerNumber: string }) => void,
  onHangup?: (info: { uuid: string }) => void,
): { stop: () => void } {
  let stopped = false;
  let socket: Socket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 5000; // Start at 5s, exponential backoff up to 60s
  let authFailed = false;

  function connectAndSubscribe() {
    if (stopped) return;

    let buffer = "";
    let authenticated = false;
    let subscribed = false;
    authFailed = false;

    socket = connect(config.eslPort, config.eslHost, () => {
      console.log("[esl-subscribe] Connected to FreeSWITCH for inbound events");
    });

    socket.setEncoding("utf-8");

    socket.on("data", (chunk: string) => {
      buffer += chunk;

      while (buffer.includes("\n\n")) {
        const delimIdx = buffer.indexOf("\n\n");
        const block = buffer.slice(0, delimIdx);
        buffer = buffer.slice(delimIdx + 2);

        const headers = parseHeaders(block);

        if (!authenticated) {
          if (headers["Content-Type"] === "auth/request") {
            socket!.write(`auth ${config.eslPassword}\n\n`);
          } else if (headers["Reply-Text"]?.startsWith("+OK")) {
            authenticated = true;
            // Reset backoff on successful auth
            reconnectDelay = 5000;
            // Subscribe to channel create (inbound detection) + hangup (cleanup).
            socket!.write("event plain CHANNEL_CREATE CHANNEL_HANGUP_COMPLETE\n\n");
          } else if (headers["Reply-Text"]?.startsWith("-ERR")) {
            authFailed = true;
            console.error("[esl-subscribe] Authentication failed:", headers["Reply-Text"]);
            socket!.destroy();
            return;
          }
        } else if (!subscribed) {
          if (headers["Reply-Text"]?.startsWith("+OK")) {
            subscribed = true;
            console.log("[esl-subscribe] Subscribed to CHANNEL_CREATE + CHANNEL_HANGUP_COMPLETE events");
          }
        } else {
          // Parse events — look for inbound calls + hangups
          if (headers["Content-Type"] === "text/event-plain") {
            const contentLength = parseInt(headers["Content-Length"] || "0", 10);
            // Read the event body
            let eventBody = "";
            if (contentLength > 0 && buffer.length >= contentLength) {
              eventBody = buffer.slice(0, contentLength);
              buffer = buffer.slice(contentLength);
            } else if (contentLength > 0) {
              // Body incomplete — restore the full original buffer (headers + delimiter + remaining)
              // so the next data event can parse the complete message
              buffer = block + "\n\n" + buffer;
              break;
            }

            // Parse event headers from the body
            const eventHeaders = parseHeaders(eventBody || block);
            const allHeaders = { ...headers, ...eventHeaders };
            const eventName = allHeaders["Event-Name"] || "";
            const uuid = allHeaders["Unique-ID"] || allHeaders["Channel-Call-UUID"] || "";

            if (eventName === "CHANNEL_CREATE") {
              const direction = allHeaders["Call-Direction"] || allHeaders["variable_call_direction"] || "";
              const callerNumber = allHeaders["Caller-Caller-ID-Number"] || allHeaders["variable_sip_from_user"] || "";
              const destNumber = allHeaders["Caller-Destination-Number"] || allHeaders["variable_destination_number"] || "";
              // Filter out SIP scanner probes / keepalive INVITEs (destination "0",
              // empty, or anything that doesn't match our DID pattern). Only real
              // inbound calls to 43… reach the heyhank dialplan, but CHANNEL_CREATE
              // fires for every INVITE even when NO_ROUTE_DESTINATION rejects it.
              const isRealDid = /^\+?43\d+$/.test(destNumber);
              if (direction === "inbound" && uuid && isRealDid) {
                console.log(`[esl-subscribe] Inbound call detected: UUID=${uuid}, caller=${callerNumber}, dest=${destNumber}`);
                try {
                  onInboundCall({ uuid, callerNumber: callerNumber || "unknown" });
                } catch (err) {
                  console.error("[esl-subscribe] onInboundCall error:", err);
                }
              }
            } else if (eventName === "CHANNEL_HANGUP_COMPLETE" && uuid && onHangup) {
              try {
                onHangup({ uuid });
              } catch (err) {
                console.error("[esl-subscribe] onHangup error:", err);
              }
            }
          }
        }
      }
    });

    socket.on("error", (err) => {
      console.error("[esl-subscribe] Connection error:", err.message);
    });

    socket.on("close", () => {
      console.log(`[esl-subscribe] Connection closed, reconnecting in ${reconnectDelay / 1000}s`);
      if (!stopped) {
        reconnectTimer = setTimeout(connectAndSubscribe, reconnectDelay);
        // Exponential backoff: 5s → 10s → 20s → 40s → 60s (max)
        if (authFailed) {
          reconnectDelay = Math.min(reconnectDelay * 2, 60000);
        }
      }
    });
  }

  connectAndSubscribe();

  return {
    stop: () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.destroy();
    },
  };
}

/**
 * Check if FreeSWITCH is reachable and authenticated.
 */
export async function eslStatus(config: FreeSwitchConfig): Promise<{ connected: boolean; status: string }> {
  try {
    const result = await eslCommand("status", config);
    return { connected: true, status: result.trim().slice(0, 300) };
  } catch (err) {
    return { connected: false, status: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Rescan external SIP profiles (picks up new/changed gateway XML files).
 */
export async function eslRescanGateways(config: FreeSwitchConfig): Promise<boolean> {
  try {
    const result = await eslCommand("sofia profile external rescan", config);
    console.log(`[telephony] ESL rescan result: ${result.trim()}`);
    return true;
  } catch (err) {
    console.error(`[telephony] ESL rescan error:`, err);
    return false;
  }
}

/**
 * Check registration status of a specific gateway.
 */
export async function eslGatewayStatus(
  gatewayName: string,
  config: FreeSwitchConfig,
): Promise<{ registered: boolean; status: string }> {
  try {
    const result = await eslCommand(`sofia status gateway ${gatewayName}`, config);
    const registered = result.includes("REGED") || result.includes("REGISTER");
    return { registered, status: result.trim().slice(0, 300) };
  } catch (err) {
    return { registered: false, status: err instanceof Error ? err.message : String(err) };
  }
}

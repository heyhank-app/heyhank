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
 */
export async function eslCommand(
  command: string,
  config: FreeSwitchConfig,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let authenticated = false;
    let commandSent = false;
    let responseBody = "";
    let expectedContentLength = 0;

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`ESL timeout after ${timeoutMs}ms`));
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
            // Send auth
            socket.write(`auth ${config.eslPassword}\n\n`);
          } else if (headers["Reply-Text"]?.startsWith("+OK")) {
            authenticated = true;
            // Send the API command
            socket.write(`api ${command}\n\n`);
            commandSent = true;
          } else if (headers["Reply-Text"]?.startsWith("-ERR")) {
            clearTimeout(timer);
            socket.destroy();
            reject(new Error(`ESL auth failed: ${headers["Reply-Text"]}`));
            return;
          }
        } else if (commandSent) {
          // Reading command response
          if (headers["Content-Type"] === "api/response") {
            expectedContentLength = parseInt(headers["Content-Length"] || "0", 10);
            if (expectedContentLength > 0) {
              // Body follows — it might already be in buffer
              if (buffer.length >= expectedContentLength) {
                responseBody = buffer.slice(0, expectedContentLength);
                clearTimeout(timer);
                socket.destroy();
                resolve(responseBody);
                return;
              }
              // Wait for more data
            } else {
              clearTimeout(timer);
              socket.destroy();
              resolve("");
              return;
            }
          }
        }
      }

      // If we're waiting for body content after headers
      if (expectedContentLength > 0 && buffer.length >= expectedContentLength) {
        responseBody = buffer.slice(0, expectedContentLength);
        clearTimeout(timer);
        socket.destroy();
        resolve(responseBody);
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`ESL connection error: ${err.message}`));
    });

    socket.on("close", () => {
      clearTimeout(timer);
      if (!commandSent) {
        reject(new Error("ESL connection closed before command sent"));
      }
      // If we already resolved/rejected, this is a no-op
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

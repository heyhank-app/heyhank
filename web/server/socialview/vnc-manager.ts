// ─── VNC Manager ─────────────────────────────────────────────────────────────
// Runs x11vnc attached to Xvfb :99, and websockify serving noVNC on
// 127.0.0.1:6080. Nginx proxies /socialview/vnc/ to this port, so the frontend
// can iframe the noVNC client.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";

const VNC_DISPLAY = ":99";
const VNC_PORT = 5900;
const WEBSOCKIFY_PORT = 6080;
const NOVNC_WEB_ROOT = "/usr/share/novnc";

let x11vncProc: ChildProcess | null = null;
let websockifyProc: ChildProcess | null = null;

function isAlive(p: ChildProcess | null): boolean {
  return !!p && !p.killed && p.exitCode === null;
}

/** Probe a local TCP port — more reliable than tracking ChildProcess when the
 *  spawned daemon forks itself off (x11vnc does this). */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port }, () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(500, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

/** Start x11vnc + websockify if not running. Idempotent. */
export async function ensureVnc(): Promise<void> {
  if (!existsSync(NOVNC_WEB_ROOT)) {
    // eslint-disable-next-line no-console
    console.warn(`[socialview] noVNC not installed at ${NOVNC_WEB_ROOT}; VNC viewer disabled`);
    return;
  }

  // Check actual port, not just ChildProcess handle, because x11vnc forks.
  const x11vncUp = await probePort(VNC_PORT);
  if (!x11vncUp && !isAlive(x11vncProc)) {
    // eslint-disable-next-line no-console
    console.log(`[socialview] starting x11vnc on display ${VNC_DISPLAY} port ${VNC_PORT}`);
    x11vncProc = spawn(
      "x11vnc",
      [
        "-display", VNC_DISPLAY,
        "-rfbport", String(VNC_PORT),
        "-localhost", // bind only to 127.0.0.1
        "-forever",
        "-shared",
        "-nopw", // auth is enforced by nginx basic auth + heyhank token on the outer proxy
        "-quiet",
        "-noxdamage",
      ],
      { stdio: "ignore" },
    );
    x11vncProc.on("exit", (code) => {
      // eslint-disable-next-line no-console
      console.log(`[socialview] x11vnc exited with code ${code}`);
      x11vncProc = null;
    });
  }

  const wsUp = await probePort(WEBSOCKIFY_PORT);
  if (!wsUp && !isAlive(websockifyProc)) {
    // eslint-disable-next-line no-console
    console.log(`[socialview] starting websockify on 127.0.0.1:${WEBSOCKIFY_PORT}`);
    websockifyProc = spawn(
      "websockify",
      [
        `127.0.0.1:${WEBSOCKIFY_PORT}`,
        `127.0.0.1:${VNC_PORT}`,
        `--web=${NOVNC_WEB_ROOT}`,
      ],
      { stdio: "ignore" },
    );
    websockifyProc.on("exit", (code) => {
      // eslint-disable-next-line no-console
      console.log(`[socialview] websockify exited with code ${code}`);
      websockifyProc = null;
    });
  }

  // Give processes a moment to bind.
  await new Promise((r) => setTimeout(r, 300));
}

export async function getVncStatus(): Promise<{ x11vnc: boolean; websockify: boolean; port: number }> {
  const [vncUp, wsUp] = await Promise.all([probePort(VNC_PORT), probePort(WEBSOCKIFY_PORT)]);
  return { x11vnc: vncUp, websockify: wsUp, port: WEBSOCKIFY_PORT };
}

export async function shutdownVnc(): Promise<void> {
  if (x11vncProc && !x11vncProc.killed) {
    x11vncProc.kill();
    x11vncProc = null;
  }
  if (websockifyProc && !websockifyProc.killed) {
    websockifyProc.kill();
    websockifyProc = null;
  }
}

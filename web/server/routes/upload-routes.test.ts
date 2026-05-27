import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";

let tempHome: string;
let app: Hono;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "heyhank-upload-routes-"));
  process.env.HEYHANK_HOME = tempHome;

  vi.resetModules();
  const { registerUploadRoutes } = await import("./upload-routes.js");
  app = new Hono();
  const api = new Hono();
  registerUploadRoutes(api);
  app.route("/api", api);
});

afterEach(() => {
  delete process.env.HEYHANK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

/** Helper to build a multipart upload Request. */
function uploadRequest(
  sessionId: string,
  files: Array<{ name: string; type: string; bytes: Uint8Array }>,
): Request {
  const fd = new FormData();
  for (const f of files) {
    // Copy into a fresh ArrayBuffer to satisfy strict BlobPart typings:
    // Uint8Array.buffer is ArrayBufferLike (may be SharedArrayBuffer) which
    // DOM's BlobPart does not accept. A fresh ArrayBuffer is unambiguous.
    const buf = new ArrayBuffer(f.bytes.byteLength);
    new Uint8Array(buf).set(f.bytes);
    fd.append("file", new File([buf], f.name, { type: f.type }));
  }
  return new Request(`http://local/api/sessions/${sessionId}/upload`, {
    method: "POST",
    body: fd,
  });
}

describe("POST /api/sessions/:id/upload", () => {
  // Happy path: single video upload returns absolute path inside the
  // per-session uploads directory and the file is actually written.
  it("stages a single file under the session uploads directory", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const res = await app.fetch(
      uploadRequest("sess-1", [{ name: "clip.mp4", type: "video/mp4", bytes }]),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].name).toBe("clip.mp4");
    expect(body.files[0].mimeType).toBe("video/mp4");
    expect(body.files[0].size).toBe(5);
    expect(body.files[0].path).toContain(join(tempHome, "uploads", "sess-1"));
    expect(existsSync(body.files[0].path)).toBe(true);
    expect(Array.from(readFileSync(body.files[0].path))).toEqual([1, 2, 3, 4, 5]);
  });

  // Multiple files in one request should be persisted and reported.
  it("supports multiple files in a single upload", async () => {
    const res = await app.fetch(
      uploadRequest("sess-2", [
        { name: "a.pdf", type: "application/pdf", bytes: new Uint8Array([10]) },
        { name: "b.txt", type: "text/plain", bytes: new Uint8Array([20, 21]) },
      ]),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(2);
    expect(body.files.map((f: { name: string }) => f.name).sort()).toEqual(["a.pdf", "b.txt"]);
  });

  // Filenames with shell-hostile characters must be sanitized to a safe
  // basename so we cannot write outside the session directory.
  it("sanitizes filenames with path traversal and unsafe characters", async () => {
    const res = await app.fetch(
      uploadRequest("sess-3", [
        { name: "../../etc/passwd", type: "text/plain", bytes: new Uint8Array([1]) },
      ]),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files[0].name).toBe("passwd");
    expect(body.files[0].path).toBe(join(tempHome, "uploads", "sess-3", "passwd"));
  });

  // Executable / script extensions must be rejected to limit the blast
  // radius of an attacker convincing the user to upload a payload that
  // the bypassPermissions agent might then execute.
  it("rejects executable file extensions", async () => {
    const res = await app.fetch(
      uploadRequest("sess-4", [
        { name: "evil.sh", type: "text/x-shellscript", bytes: new Uint8Array([1]) },
      ]),
    );
    // Single-file all-rejected request → 400 with detailed errors.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors[0].name).toBe("evil.sh");
    expect(body.errors[0].error).toMatch(/not allowed/);
  });

  // Mixed batch: one good + one bad → 200, good is staged, bad is reported.
  it("returns partial success when some files are rejected", async () => {
    const res = await app.fetch(
      uploadRequest("sess-5", [
        { name: "ok.mp4", type: "video/mp4", bytes: new Uint8Array([1]) },
        { name: "bad.exe", type: "application/octet-stream", bytes: new Uint8Array([1]) },
      ]),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].name).toBe("ok.mp4");
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].name).toBe("bad.exe");
  });

  // Filename collisions within a session must auto-rename to keep both copies.
  it("auto-renames colliding filenames in the same session", async () => {
    await app.fetch(
      uploadRequest("sess-6", [{ name: "report.pdf", type: "application/pdf", bytes: new Uint8Array([1]) }]),
    );
    const res = await app.fetch(
      uploadRequest("sess-6", [{ name: "report.pdf", type: "application/pdf", bytes: new Uint8Array([2]) }]),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files[0].name).toBe("report_1.pdf");
    expect(existsSync(join(tempHome, "uploads", "sess-6", "report.pdf"))).toBe(true);
    expect(existsSync(join(tempHome, "uploads", "sess-6", "report_1.pdf"))).toBe(true);
  });

  // Non-multipart content type should be rejected early with a clear error.
  it("rejects non-multipart bodies with 400", async () => {
    const res = await app.request("/api/sessions/sess-7/upload", {
      method: "POST",
      body: JSON.stringify({ file: "nope" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  // Multipart with no `file` field should be rejected.
  it("rejects requests with no file field", async () => {
    const fd = new FormData();
    fd.append("notfile", "x");
    const res = await app.fetch(
      new Request("http://local/api/sessions/sess-8/upload", { method: "POST", body: fd }),
    );
    expect(res.status).toBe(400);
  });
});

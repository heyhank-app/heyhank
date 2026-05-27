// Tests for the FB comments poller. Mocks fetch (Graph API), exercises the
// dedupe ring, no-config / Graph-error fallbacks, and the multi-post +
// multi-comment iteration.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We mock the webhook-routes pipeline because pollOnce calls it for each new
// comment. The mock lets us assert which CommentEvents would have been
// dispatched without touching the actual Match-Engine.
const mockProcessCommentEvent = vi.hoisted(() =>
  vi.fn<(ev: unknown) => Promise<{ matched: boolean; sent: boolean }>>(async () => ({ matched: false, sent: false })),
);

vi.mock("./meta-webhook-routes.js", () => ({
  processCommentEvent: mockProcessCommentEvent,
}));

let tempHome: string;
type PollerModule = typeof import("./poll-fb-comments.js");
type SecretsModule = typeof import("./meta-secrets.js");
let poller: PollerModule;
let secrets: SecretsModule;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "fb-poll-test-"));
  process.env.HEYHANK_HOME = tempHome;
  vi.resetModules();
  vi.clearAllMocks();
  poller = await import("./poll-fb-comments.js");
  secrets = await import("./meta-secrets.js");

  // Default: configured Page so pollOnce will actually try to fetch.
  secrets.saveMetaSecrets({
    pageId: "850520934808190",
    pageAccessToken: "EAAtest-page-token",
    fbAppId: "909156382186050",
    fbAppSecret: "test-fb-app-secret",
    appId: "1206785405842211",
    appSecret: "test-ig-app-secret",
    webhookVerify: "wv",
  });
});

afterEach(() => {
  poller.stopFbCommentPoller();
  vi.unstubAllGlobals();
  rmSync(tempHome, { recursive: true, force: true });
});

// ─── No-config + Graph-error short-circuits ──────────────────────────────────

describe("pollOnce — guard clauses", () => {
  it("returns ok=false with explanatory error when FB Page is not configured", async () => {
    secrets.saveMetaSecrets({ pageId: "", pageAccessToken: "" });
    const res = await poller.pollOnce();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/FB Page not configured/);
  });

  it("surfaces Graph API errors cleanly (HTTP 400 with error.message)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "Invalid access token", code: 190 } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )));
    const res = await poller.pollOnce();
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Invalid access token");
  });

  it("survives network errors without crashing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const res = await poller.pollOnce();
    expect(res.ok).toBe(false);
    expect(res.error).toBe("ECONNREFUSED");
  });
});

// ─── Comment dispatch ────────────────────────────────────────────────────────

describe("pollOnce — comment dispatch", () => {
  function mockGraphResponse(posts: unknown[]) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ data: posts }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
  }

  it("dispatches each new comment as a facebook CommentEvent", async () => {
    mockGraphResponse([
      {
        id: "post-1",
        comments: {
          data: [
            { id: "c1", message: "Comment COURSES please", created_time: "2026-05-25T10:00:00+0000", from: { id: "u1", name: "Anna" } },
            { id: "c2", message: "Hello", created_time: "2026-05-25T10:01:00+0000", from: { id: "u2", name: "Bob" } },
          ],
        },
      },
    ]);

    const res = await poller.pollOnce();
    expect(res.ok).toBe(true);
    expect(res.postsScanned).toBe(1);
    expect(res.newComments).toBe(2);
    expect(mockProcessCommentEvent).toHaveBeenCalledTimes(2);

    const ev1 = mockProcessCommentEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(ev1.platform).toBe("facebook");
    expect(ev1.postId).toBe("post-1");
    expect(ev1.commentId).toBe("c1");
    expect(ev1.commenterId).toBe("u1");
    expect(ev1.commenterName).toBe("Anna");
    expect(ev1.text).toBe("Comment COURSES please");
  });

  it("dedupes: a comment seen in two consecutive polls is dispatched ONLY once", async () => {
    const post = {
      id: "post-1",
      comments: { data: [{ id: "c1", message: "first", from: { id: "u1" } }] },
    };
    mockGraphResponse([post]);
    await poller.pollOnce(); // first poll → dispatched
    expect(mockProcessCommentEvent).toHaveBeenCalledTimes(1);

    // Same comment returned again on second poll (e.g. Graph included it due
    // to since-window race). Should NOT re-dispatch.
    mockGraphResponse([post]);
    await poller.pollOnce();
    expect(mockProcessCommentEvent).toHaveBeenCalledTimes(1);
  });

  it("counts matched + sent from the processCommentEvent results", async () => {
    mockProcessCommentEvent.mockResolvedValueOnce({ matched: true, sent: true });
    mockProcessCommentEvent.mockResolvedValueOnce({ matched: true, sent: false });
    mockProcessCommentEvent.mockResolvedValueOnce({ matched: false, sent: false });
    mockGraphResponse([
      {
        id: "post-1",
        comments: {
          data: [
            { id: "c1", message: "x", from: { id: "u1" } },
            { id: "c2", message: "y", from: { id: "u2" } },
            { id: "c3", message: "z", from: { id: "u3" } },
          ],
        },
      },
    ]);

    const res = await poller.pollOnce();
    expect(res.newComments).toBe(3);
    expect(res.matched).toBe(2);
    expect(res.sent).toBe(1);
  });

  it("handles multiple posts each with their own comments", async () => {
    mockGraphResponse([
      { id: "p1", comments: { data: [{ id: "c1", message: "a", from: { id: "u1" } }] } },
      { id: "p2", comments: { data: [{ id: "c2", message: "b", from: { id: "u2" } }] } },
      { id: "p3", comments: { data: [] } },
      { id: "p4" }, // no comments at all
    ]);
    const res = await poller.pollOnce();
    expect(res.postsScanned).toBe(4);
    expect(res.newComments).toBe(2);
    expect(mockProcessCommentEvent).toHaveBeenCalledTimes(2);
  });

  it("skips comments without an `id` or `from.id` (malformed Graph payload)", async () => {
    mockGraphResponse([
      {
        id: "p1",
        comments: {
          data: [
            { id: "c1", from: { id: "u1" }, message: "ok" },
            { id: "", from: { id: "u1" }, message: "missing-id" },
            { id: "c2", from: {}, message: "missing-from-id" },
          ],
        },
      },
    ]);
    const res = await poller.pollOnce();
    expect(res.newComments).toBe(1);
    expect(mockProcessCommentEvent).toHaveBeenCalledTimes(1);
  });

  it("always advances lastPollAt even when there are no new comments", async () => {
    mockGraphResponse([]);
    const before = Date.now();
    await poller.pollOnce();
    const stateFile = join(tempHome, "automation", "fb-poll-state.json");
    expect(existsSync(stateFile)).toBe(true);
    const state = JSON.parse(readFileSync(stateFile, "utf-8")) as { lastPollAt: string };
    expect(Date.parse(state.lastPollAt)).toBeGreaterThanOrEqual(before);
  });
});

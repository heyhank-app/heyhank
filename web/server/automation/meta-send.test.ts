// Tests for the Meta send helpers — focused on sendCommentReply's platform
// routing (IG /replies vs FB /comments) and error surfacing. fetch + the Meta
// secrets are mocked so no real Graph calls happen.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CommentEvent } from "./meta-webhook.js";

// Mock the secrets module so both platforms have a usable token.
vi.mock("./meta-secrets.js", () => ({
  getMetaSecrets: () => ({
    userAccessToken: "ig-user-token",
    pageAccessToken: "fb-page-token",
  }),
}));

import { sendCommentReply } from "./meta-send.js";

function makeEvent(overrides: Partial<CommentEvent> = {}): CommentEvent {
  return {
    platform: "instagram",
    postId: "post-1",
    commentId: "comment-99",
    commenterId: "user-1",
    text: "GUIDE",
    receivedAt: Date.now(),
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "reply-123" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendCommentReply — platform routing", () => {
  it("Instagram posts to graph.instagram.com /{comment}/replies with the user token", async () => {
    const res = await sendCommentReply({ event: makeEvent({ platform: "instagram" }), replyText: "Sent 📩" });
    expect(res.ok).toBe(true);
    expect(res.replyId).toBe("reply-123");

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("graph.instagram.com");
    expect(url).toContain("/comment-99/replies");
    expect(url).toContain("access_token=ig-user-token");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ message: "Sent 📩" });
  });

  it("Facebook posts to graph.facebook.com /{comment}/comments with the page token", async () => {
    const res = await sendCommentReply({ event: makeEvent({ platform: "facebook" }), replyText: "Check DMs" });
    expect(res.ok).toBe(true);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("graph.facebook.com");
    expect(url).toContain("/comment-99/comments");
    expect(url).toContain("access_token=fb-page-token");
  });

  it("surfaces a Graph error message on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "(#10) permission denied" } }), { status: 403 }),
    );
    const res = await sendCommentReply({ event: makeEvent(), replyText: "hi" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("permission denied");
  });
});

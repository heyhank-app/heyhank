// Tests for PostizAdapter.createPost — focusing on the format-routing branch:
// "post"/"carousel" → settings.post_type = "post" + first comment threaded
// "story"           → settings.post_type = "story" + first comment suppressed
// "reel"            → settings.post_type = "post" (Postiz auto-detects REELS
//                     from the media MIME, no extra flag needed at our layer)
//
// We mock global fetch so the adapter never touches the network, and we capture
// the body sent to POST /public/v1/posts to assert what Postiz would see.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PostizAdapter } from "./postiz-adapter.js";

type FetchCall = { url: string; init: RequestInit | undefined };

function setupFetchMock() {
  const calls: FetchCall[] = [];
  const fetchSpy = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });

    // /integrations → connected channels
    if (url.endsWith("/integrations")) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: "ig-id", name: "Markus IG", identifier: "instagram", picture: null },
          { id: "fb-id", name: "Markus FB", identifier: "facebook", picture: null },
        ],
      };
    }
    // /upload (multipart) → returns the Postiz media descriptor
    if (url.endsWith("/upload")) {
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: "media-1", path: "https://cdn.example/media-1.jpg" }),
      };
    }
    // /posts → success
    if (url.endsWith("/posts")) {
      return {
        ok: true,
        status: 201,
        json: async () => [{ id: "postiz-post-id" }],
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  // @ts-expect-error — replacing global for the duration of the test
  globalThis.fetch = fetchSpy;
  return { calls, fetchSpy };
}

function lastPostsBody(calls: FetchCall[]): any {
  const postsCall = [...calls].reverse().find((c) => c.url.endsWith("/posts"));
  if (!postsCall?.init?.body) throw new Error("no /posts call captured");
  return JSON.parse(String(postsCall.init.body));
}

describe("PostizAdapter format-routing", () => {
  let calls: FetchCall[];
  beforeEach(() => {
    const m = setupFetchMock();
    calls = m.calls;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A regular feed post: post_type=post, firstComment threaded as a second entry.
  it("format=post sets settings.post_type='post' and threads firstComment", async () => {
    const adapter = new PostizAdapter({ url: "https://postiz.example.com", apiKey: "key" });
    await adapter.createPost({
      text: "Body of the post",
      platforms: ["instagram"],
      format: "post",
      firstComment: "Drop WORD below 👇",
      mediaUrls: [],
    });
    const body = lastPostsBody(calls);
    const igPost = body.posts.find((p: any) => p.settings.__type === "instagram");
    expect(igPost.settings.post_type).toBe("post");
    expect(igPost.value).toHaveLength(2); // body + first comment
    expect(igPost.value[1].content).toBe("Drop WORD below 👇");
  });

  // Carousel = same routing as post (Postiz detects multiple-media → carousel).
  it("format=carousel sets settings.post_type='post' (Postiz auto-detects carousel from media count)", async () => {
    const adapter = new PostizAdapter({ url: "https://postiz.example.com", apiKey: "key" });
    await adapter.createPost({
      text: "Carousel body",
      platforms: ["instagram"],
      format: "carousel",
      firstComment: "Drop WORD",
      mediaUrls: [],
    });
    const body = lastPostsBody(calls);
    const igPost = body.posts.find((p: any) => p.settings.__type === "instagram");
    expect(igPost.settings.post_type).toBe("post");
    expect(igPost.value).toHaveLength(2);
  });

  // Story: post_type=story AND firstComment suppressed (no comment thread on a 24h Story).
  it("format=story sets settings.post_type='story' and DROPS firstComment", async () => {
    const adapter = new PostizAdapter({ url: "https://postiz.example.com", apiKey: "key" });
    await adapter.createPost({
      text: "Story overlay text",
      platforms: ["instagram"],
      format: "story",
      firstComment: "this should be ignored", // not allowed on stories
      mediaUrls: [],
    });
    const body = lastPostsBody(calls);
    const igPost = body.posts.find((p: any) => p.settings.__type === "instagram");
    expect(igPost.settings.post_type).toBe("story");
    expect(igPost.value).toHaveLength(1); // first comment dropped
    expect(igPost.value[0].content).toBe("Story overlay text");
  });

  // Reel: post_type=post (Postiz infers REELS from the video MIME at the IG layer).
  it("format=reel sets settings.post_type='post' (Postiz routes IG video → REELS)", async () => {
    const adapter = new PostizAdapter({ url: "https://postiz.example.com", apiKey: "key" });
    await adapter.createPost({
      text: "Reel caption",
      platforms: ["instagram"],
      format: "reel",
      firstComment: "PIN: drop WORD",
      mediaUrls: [],
    });
    const body = lastPostsBody(calls);
    const igPost = body.posts.find((p: any) => p.settings.__type === "instagram");
    expect(igPost.settings.post_type).toBe("post");
    expect(igPost.value).toHaveLength(2);
  });

  // Facebook never gets post_type=story — provider doesn't expose FB Story in
  // the public Postiz API. Best-effort: even if we mark the post as Story for
  // IG, FB drops back to a feed post.
  it("format=story for Facebook still uses post_type='post' on the FB integration", async () => {
    const adapter = new PostizAdapter({ url: "https://postiz.example.com", apiKey: "key" });
    await adapter.createPost({
      text: "Cross-posted story",
      platforms: ["instagram", "facebook"],
      format: "story",
      mediaUrls: [],
    });
    const body = lastPostsBody(calls);
    const ig = body.posts.find((p: any) => p.settings.__type === "instagram");
    const fb = body.posts.find((p: any) => p.settings.__type === "facebook");
    expect(ig.settings.post_type).toBe("story");
    expect(fb.settings.post_type).toBe("post");
  });

  // No format provided → backwards-compatible default of "post".
  it("undefined format defaults to post_type='post'", async () => {
    const adapter = new PostizAdapter({ url: "https://postiz.example.com", apiKey: "key" });
    await adapter.createPost({
      text: "Legacy draft without format hint",
      platforms: ["instagram"],
      mediaUrls: [],
    });
    const body = lastPostsBody(calls);
    const igPost = body.posts.find((p: any) => p.settings.__type === "instagram");
    expect(igPost.settings.post_type).toBe("post");
  });
});

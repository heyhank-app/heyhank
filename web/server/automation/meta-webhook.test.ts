// Tests for meta-webhook.ts — signature verification + comment-event parsing.
// We do NOT test the route handlers here (those need a Hono test harness);
// the pure functions cover the security-critical and shape-correctness logic.

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyMetaSignature, extractCommentEvents } from "./meta-webhook.js";

// ─── verifyMetaSignature ─────────────────────────────────────────────────────

describe("verifyMetaSignature", () => {
  const appSecret = "test-app-secret-do-not-use";
  const body = JSON.stringify({ object: "page", entry: [{ id: "123" }] });
  const validSig = "sha256=" + createHmac("sha256", appSecret).update(body).digest("hex");

  it("accepts a correctly-signed body", () => {
    expect(verifyMetaSignature(body, validSig, appSecret)).toBe(true);
  });

  it("rejects when the signature header is missing or empty", () => {
    expect(verifyMetaSignature(body, null, appSecret)).toBe(false);
    expect(verifyMetaSignature(body, undefined, appSecret)).toBe(false);
    expect(verifyMetaSignature(body, "", appSecret)).toBe(false);
  });

  it("rejects when the body has been tampered with", () => {
    const tampered = body + " ";
    expect(verifyMetaSignature(tampered, validSig, appSecret)).toBe(false);
  });

  it("rejects when the secret is wrong", () => {
    expect(verifyMetaSignature(body, validSig, "other-secret")).toBe(false);
  });

  it("rejects malformed signature headers (no sha256= prefix or wrong length)", () => {
    expect(verifyMetaSignature(body, "abc123", appSecret)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=tooshort", appSecret)).toBe(false);
    expect(verifyMetaSignature(body, "sha1=" + "a".repeat(64), appSecret)).toBe(false);
  });

  it("rejects when no app secret is configured", () => {
    expect(verifyMetaSignature(body, validSig, "")).toBe(false);
  });
});

// ─── extractCommentEvents ────────────────────────────────────────────────────

describe("extractCommentEvents", () => {
  it("extracts Facebook page-comment events with field=feed, item=comment, verb=add", () => {
    const payload = {
      object: "page",
      entry: [{
        id: "page-1",
        time: 1779500000,
        changes: [{
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "comment-abc",
            post_id: "post-xyz",
            from: { id: "user-42", name: "Test User" },
            message: "Comment COURSES please",
          },
        }],
      }],
    };
    const events = extractCommentEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      platform: "facebook",
      postId: "post-xyz",
      commentId: "comment-abc",
      commenterId: "user-42",
      commenterName: "Test User",
      text: "Comment COURSES please",
    });
    expect(events[0].receivedAt).toBe(1779500000 * 1000);
  });

  it("extracts Instagram comment events with field=comments", () => {
    const payload = {
      object: "instagram",
      entry: [{
        id: "ig-1",
        time: 1779500000,
        changes: [{
          field: "comments",
          value: {
            id: "ig-comment-1",
            media: { id: "ig-media-1" },
            from: { id: "ig-user-1", username: "tester" },
            text: "COURSES",
          },
        }],
      }],
    };
    const events = extractCommentEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      platform: "instagram",
      postId: "ig-media-1",
      commentId: "ig-comment-1",
      commenterId: "ig-user-1",
      commenterName: "tester",
      text: "COURSES",
    });
  });

  it("ignores edited comments (verb=edited) — only NEW comments fire rules", () => {
    const payload = {
      object: "page",
      entry: [{
        id: "p",
        changes: [{
          field: "feed",
          value: { item: "comment", verb: "edited", comment_id: "c", post_id: "p", from: { id: "u" }, message: "x" },
        }],
      }],
    };
    expect(extractCommentEvents(payload)).toEqual([]);
  });

  it("ignores non-comment feed events (likes, status updates)", () => {
    const payload = {
      object: "page",
      entry: [{
        id: "p",
        changes: [
          { field: "feed", value: { item: "like", verb: "add", post_id: "p" } },
          { field: "feed", value: { item: "status", verb: "add", post_id: "p" } },
        ],
      }],
    };
    expect(extractCommentEvents(payload)).toEqual([]);
  });

  it("handles batches: multiple entries, each with multiple comment changes", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "ig",
          changes: [
            { field: "comments", value: { id: "c1", media: { id: "m1" }, from: { id: "u1" }, text: "a" } },
            { field: "comments", value: { id: "c2", media: { id: "m2" }, from: { id: "u2" }, text: "b" } },
          ],
        },
        {
          id: "ig2",
          changes: [
            { field: "comments", value: { id: "c3", media: { id: "m3" }, from: { id: "u3" }, text: "c" } },
          ],
        },
      ],
    };
    const events = extractCommentEvents(payload);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.commentId)).toEqual(["c1", "c2", "c3"]);
  });

  it("skips comment events that are missing required IDs (graceful degrade)", () => {
    const payload = {
      object: "page",
      entry: [{
        id: "p",
        changes: [
          { field: "feed", value: { item: "comment", verb: "add" } }, // no IDs
          { field: "feed", value: { item: "comment", verb: "add", comment_id: "c", post_id: "p", from: { id: "u" }, message: "ok" } },
        ],
      }],
    };
    const events = extractCommentEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0].commentId).toBe("c");
  });

  it("returns empty array on totally malformed input", () => {
    expect(extractCommentEvents(null)).toEqual([]);
    expect(extractCommentEvents({})).toEqual([]);
    expect(extractCommentEvents({ object: "page", entry: "not-array" })).toEqual([]);
  });
});

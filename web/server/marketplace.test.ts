import { describe, expect, it } from "vitest";
import { BUILTIN_SOURCES, getSource } from "./marketplace.js";

describe("marketplace built-in sources", () => {
  it("includes TweetClaw as a built-in skill source", () => {
    const source = getSource("xquik-dev-tweetclaw");

    expect(source).toMatchObject({
      id: "xquik-dev-tweetclaw",
      name: "TweetClaw",
      owner: "Xquik",
      url: "https://github.com/Xquik-dev/tweetclaw",
      ghOwner: "Xquik-dev",
      ghRepo: "tweetclaw",
      branch: "master",
    });
    expect(BUILTIN_SOURCES.map((s) => s.id)).toContain("xquik-dev-tweetclaw");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Resolve the module after HEYHANK_HOME is set so the in-module MEDIA_DIR
// constant points at our temp dir instead of the real ~/.heyhank/.
let detectVeoMode: typeof import("./fal-video.js").detectVeoMode;
let readImageAsBase64: typeof import("./fal-video.js").readImageAsBase64;
let buildVeoRequestBody: typeof import("./fal-video.js").buildVeoRequestBody;

let tempHome: string;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "heyhank-fal-video-"));
  process.env.HEYHANK_HOME = tempHome;
  vi.resetModules();
  const mod = await import("./fal-video.js");
  detectVeoMode = mod.detectVeoMode;
  readImageAsBase64 = mod.readImageAsBase64;
  buildVeoRequestBody = mod.buildVeoRequestBody;
});

afterEach(() => {
  delete process.env.HEYHANK_HOME;
  rmSync(tempHome, { recursive: true, force: true });
});

describe("detectVeoMode", () => {
  // Caller-provided `mode` always wins over auto-detection, even if conflicting
  // image fields are present — gives the agent an escape hatch.
  it("respects explicit mode override", () => {
    expect(
      detectVeoMode({ mode: "text", referenceImagePaths: ["/x.jpg"] }),
    ).toBe("text");
  });

  // Any referenceImagePaths entry → reference mode (subject-consistency).
  it("infers reference mode from referenceImagePaths", () => {
    expect(detectVeoMode({ referenceImagePaths: ["/x.jpg"] })).toBe("reference");
  });

  // Both first and last frame → firstLastFrame, distinct from firstFrame alone.
  it("infers firstLastFrame when both first+last are set", () => {
    expect(
      detectVeoMode({
        firstFrameImagePath: "/a.jpg",
        lastFrameImagePath: "/b.jpg",
      }),
    ).toBe("firstLastFrame");
  });

  it("infers firstFrame when only firstFrameImagePath is set", () => {
    expect(detectVeoMode({ firstFrameImagePath: "/a.jpg" })).toBe("firstFrame");
  });

  // Legacy imageUrls (older callers) maps to reference mode for backward-compat.
  it("falls back to reference mode for legacy imageUrls only", () => {
    expect(detectVeoMode({ imageUrls: ["https://x/y.jpg"] })).toBe("reference");
  });

  it("defaults to text mode when no image fields are set", () => {
    expect(detectVeoMode({})).toBe("text");
  });
});

describe("readImageAsBase64", () => {
  // MIME type is derived from extension so PNG/WebP refs aren't sent as JPEG
  // (which would cause Google Veo to reject the body).
  it("base64-encodes a local PNG and reports image/png", async () => {
    const fp = join(tempHome, "x.png");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]);
    writeFileSync(fp, bytes);
    const { data, mimeType } = await readImageAsBase64(fp);
    expect(mimeType).toBe("image/png");
    expect(data).toBe(bytes.toString("base64"));
  });

  it("resolves ~ paths against $HOME", async () => {
    const home = process.env.HOME!;
    const name = `heyhank-test-${Date.now()}.jpeg`;
    const fp = join(home, name);
    writeFileSync(fp, Buffer.from([1, 2, 3]));
    try {
      const { data, mimeType } = await readImageAsBase64(`~/${name}`);
      expect(mimeType).toBe("image/jpeg");
      expect(Buffer.from(data, "base64")).toEqual(Buffer.from([1, 2, 3]));
    } finally {
      rmSync(fp, { force: true });
    }
  });

  // /api/references/file/<cat>/<name> URLs are resolved against
  // $HEYHANK_HOME/reference-images/<cat>/<name>, not fetched over HTTP — the
  // backend has direct disk access.
  it("resolves HeyHank reference URLs to local reference-images path", async () => {
    const refDir = join(tempHome, "reference-images", "person");
    mkdirSync(refDir, { recursive: true });
    const fp = join(refDir, "ref_abc.webp");
    writeFileSync(fp, Buffer.from([9, 9, 9]));

    const { data, mimeType } = await readImageAsBase64(
      "/api/references/file/person/ref_abc.webp",
    );
    expect(mimeType).toBe("image/webp");
    expect(Buffer.from(data, "base64")).toEqual(Buffer.from([9, 9, 9]));
  });

  it("throws when local file is missing", async () => {
    await expect(readImageAsBase64("/no/such/file.jpg")).rejects.toThrow(/not found/i);
  });
});

describe("buildVeoRequestBody", () => {
  // Plain text-to-video: no image keys, just prompt + parameters.
  it("produces a text-only instance when no image fields are set", async () => {
    const body = await buildVeoRequestBody({ prompt: "hello world" });
    expect(body.instances).toHaveLength(1);
    expect(body.instances[0]).toEqual({ prompt: "hello world" });
    expect(body.parameters).toMatchObject({
      aspectRatio: "9:16",
      durationSeconds: 8,
      sampleCount: 1,
    });
  });

  // reference mode → `referenceImages` array of `{ image: {...} }`, capped at 3.
  it("emits referenceImages (capped at 3) with base64 + mimeType in reference mode", async () => {
    const dir = join(tempHome, "refs");
    mkdirSync(dir);
    const paths: string[] = [];
    for (let i = 0; i < 4; i++) {
      const fp = join(dir, `r${i}.jpeg`);
      writeFileSync(fp, Buffer.from([i + 1]));
      paths.push(fp);
    }
    const body = await buildVeoRequestBody({
      prompt: "p",
      referenceImagePaths: paths,
    });
    const ref = (body.instances[0] as { referenceImages: Array<{ image: { bytesBase64Encoded: string; mimeType: string } }> })
      .referenceImages;
    expect(ref).toHaveLength(3);
    expect(ref[0].image.mimeType).toBe("image/jpeg");
    expect(Buffer.from(ref[0].image.bytesBase64Encoded, "base64")).toEqual(Buffer.from([1]));
  });

  // firstFrame mode → `image` field directly on instance (not `referenceImages`).
  it("emits `image` for firstFrame mode", async () => {
    const fp = join(tempHome, "first.png");
    writeFileSync(fp, Buffer.from([42]));
    const body = await buildVeoRequestBody({
      prompt: "p",
      firstFrameImagePath: fp,
    });
    const inst = body.instances[0] as { image: { bytesBase64Encoded: string; mimeType: string } };
    expect(inst.image.mimeType).toBe("image/png");
    expect(Buffer.from(inst.image.bytesBase64Encoded, "base64")).toEqual(Buffer.from([42]));
  });

  // firstLastFrame mode → both `image` and `lastFrame` on the instance.
  it("emits image + lastFrame for firstLastFrame mode", async () => {
    const a = join(tempHome, "a.jpg");
    const b = join(tempHome, "b.jpg");
    writeFileSync(a, Buffer.from([1]));
    writeFileSync(b, Buffer.from([2]));
    const body = await buildVeoRequestBody({
      prompt: "p",
      firstFrameImagePath: a,
      lastFrameImagePath: b,
    });
    const inst = body.instances[0] as {
      image: { bytesBase64Encoded: string };
      lastFrame: { bytesBase64Encoded: string };
    };
    expect(Buffer.from(inst.image.bytesBase64Encoded, "base64")).toEqual(Buffer.from([1]));
    expect(Buffer.from(inst.lastFrame.bytesBase64Encoded, "base64")).toEqual(Buffer.from([2]));
  });

  // Legacy `imageUrls` callers continue to work via reference mode auto-mapping.
  it("treats legacy imageUrls as reference inputs", async () => {
    const fp = join(tempHome, "leg.gif");
    writeFileSync(fp, Buffer.from([7]));
    const body = await buildVeoRequestBody({
      prompt: "p",
      imageUrls: [fp],
    });
    const ref = (body.instances[0] as { referenceImages: Array<{ image: { mimeType: string } }> })
      .referenceImages;
    expect(ref).toHaveLength(1);
    expect(ref[0].image.mimeType).toBe("image/gif");
  });
});

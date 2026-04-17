// @vitest-environment jsdom
/**
 * Tests for the TalkingHeadAvatar component.
 *
 * The component wraps the @met4citizen/talkinghead 3D library to render an
 * animated avatar driven by Gemini Live PCM audio. These tests focus on:
 * - Graceful fallback rendering when WebGL is unavailable in jsdom
 * - Basic accessibility compliance (no axe violations on fallback UI)
 * - The imperative ref API is no-op-safe before the 3D scene is ready
 *
 * We deliberately do NOT try to exercise the real three.js renderer in
 * jsdom: it has no WebGL and would throw on instantiation. Instead the
 * component is designed to detect this and render an "unavailable" message,
 * which we verify here. End-to-end avatar rendering is covered by manual
 * in-browser testing.
 */
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TalkingHeadAvatar, type TalkingHeadAvatarHandle } from "./TalkingHeadAvatar";

// Force the WebGL availability check inside the component to fail.
// jsdom returns null from getContext("webgl"/"webgl2") by default, which already
// drives the "unsupported" branch, but we stub explicitly to be robust across
// jsdom versions.
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});

describe("TalkingHeadAvatar", () => {
  it("renders the unsupported fallback when WebGL is unavailable", () => {
    render(<TalkingHeadAvatar avatarUrl="https://example.com/avatar.glb" />);
    expect(
      screen.getByText(/3D avatar unavailable \(WebGL not supported\)/i),
    ).toBeInTheDocument();
  });

  it("passes an axe accessibility scan on the fallback UI", async () => {
    const { axe } = await import("vitest-axe");
    const { container } = render(
      <TalkingHeadAvatar avatarUrl="https://example.com/avatar.glb" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("exposes an imperative ref whose methods are safe to call when not ready", () => {
    const ref = createRef<TalkingHeadAvatarHandle>();
    render(<TalkingHeadAvatar ref={ref} avatarUrl="https://example.com/avatar.glb" />);
    // All ref methods must be defined and no-op without throwing while the
    // WebGL scene is unavailable — HankChat calls feedPcm on every audio chunk
    // from Gemini and must not crash if the avatar failed to initialize.
    expect(ref.current).not.toBeNull();
    expect(() => ref.current?.feedPcm(new Uint8Array([0, 0, 0, 0]))).not.toThrow();
    expect(() => ref.current?.feedPcm(new Uint8Array(0))).not.toThrow();
    expect(() => ref.current?.notifyEnd()).not.toThrow();
    expect(() => ref.current?.interrupt()).not.toThrow();
    expect(() => ref.current?.setMood("happy")).not.toThrow();
    expect(() => ref.current?.playGesture("thumbup")).not.toThrow();
  });

  it("applies a custom className to the root container", () => {
    const { container } = render(
      <TalkingHeadAvatar
        avatarUrl="https://example.com/avatar.glb"
        className="custom-avatar-root"
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass("custom-avatar-root");
  });
});

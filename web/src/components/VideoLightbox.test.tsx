// @vitest-environment jsdom
// Tests for VideoLightbox: renders a playable video, backdrop + Escape dismiss,
// click on the video does not close, axe-clean.

import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { axe } from "vitest-axe";
import { VideoLightbox } from "./VideoLightbox.js";

afterEach(() => cleanup());

describe("VideoLightbox", () => {
  it("renders the video (with poster) and a labelled close button", () => {
    render(<VideoLightbox url="/api/media/file/clip.mp4" poster="/api/media/file/poster.jpg" onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const vid = screen.getByTestId("video-lightbox-player");
    expect(vid).toHaveAttribute("src", "/api/media/file/clip.mp4");
    expect(vid).toHaveAttribute("poster", "/api/media/file/poster.jpg");
    expect(screen.getByRole("button", { name: /close video viewer/i })).toBeInTheDocument();
  });

  it("renders nothing when url is empty", () => {
    const { container } = render(<VideoLightbox url="" onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("closes on backdrop click but not when clicking the video", () => {
    const onClose = vi.fn();
    render(<VideoLightbox url="/clip.mp4" onClose={onClose} />);
    // Clicking the video (inside the inner wrapper) must NOT close.
    fireEvent.click(screen.getByTestId("video-lightbox-player"));
    expect(onClose).not.toHaveBeenCalled();
    // Clicking the backdrop closes.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the close button and on Escape", () => {
    const onClose = vi.fn();
    render(<VideoLightbox url="/clip.mp4" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close video viewer/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("has no axe violations", async () => {
    const { container } = render(<VideoLightbox url="/clip.mp4" onClose={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20000);
});

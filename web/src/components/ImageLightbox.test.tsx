// @vitest-environment jsdom
// Tests for ImageLightbox: keyboard navigation, backdrop dismissal, axe-clean.
// Multiple-image carousel cycles via arrow keys + Home/End jumps.

import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ImageLightbox } from "./ImageLightbox.js";

afterEach(() => cleanup());

const URLS = ["/img/a.png", "/img/b.png", "/img/c.png"];

describe("ImageLightbox", () => {
  // Smoke test — renders the starting image with role=dialog and a labelled close button.
  it("renders the start image and a labelled close button", () => {
    render(<ImageLightbox urls={URLS} startIndex={1} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByAltText(/Image 2 of 3/i)).toHaveAttribute("src", "/img/b.png");
    expect(screen.getByRole("button", { name: /close image viewer/i })).toBeInTheDocument();
  });

  // Backdrop click should call onClose. Clicks inside the image container must NOT close.
  it("closes on backdrop click but not on image click", () => {
    const onClose = vi.fn();
    render(<ImageLightbox urls={URLS} onClose={onClose} />);
    // Clicking the image (inside the inner wrapper) does not close
    fireEvent.click(screen.getByAltText(/Image 1 of 3/i));
    expect(onClose).not.toHaveBeenCalled();
    // Clicking the dialog backdrop closes
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Escape key closes via the document-level keydown listener.
  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(<ImageLightbox urls={URLS} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ArrowRight advances and wraps. ArrowLeft retreats and wraps backwards.
  it("navigates with arrow keys and wraps at boundaries", () => {
    render(<ImageLightbox urls={URLS} startIndex={0} onClose={() => {}} />);
    expect(screen.getByAltText(/Image 1 of 3/i)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByAltText(/Image 2 of 3/i)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByAltText(/Image 3 of 3/i)).toBeInTheDocument();
    // Wrap forward
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByAltText(/Image 1 of 3/i)).toBeInTheDocument();
    // Wrap backward
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByAltText(/Image 3 of 3/i)).toBeInTheDocument();
  });

  // Home jumps to first image, End to last.
  it("jumps to first/last via Home and End keys", () => {
    render(<ImageLightbox urls={URLS} startIndex={1} onClose={() => {}} />);
    fireEvent.keyDown(document, { key: "End" });
    expect(screen.getByAltText(/Image 3 of 3/i)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Home" });
    expect(screen.getByAltText(/Image 1 of 3/i)).toBeInTheDocument();
  });

  // For single-image lightboxes, prev/next buttons must not render and the
  // position indicator must be absent. This keeps the chrome minimal.
  it("hides nav buttons and counter for single image", () => {
    render(<ImageLightbox urls={["/only.png"]} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /previous/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^1\s*\/\s*1$/)).not.toBeInTheDocument();
  });

  // Clamps a startIndex that's out of range so it never blows up the UI.
  it("clamps an out-of-range startIndex", () => {
    render(<ImageLightbox urls={URLS} startIndex={99} onClose={() => {}} />);
    expect(screen.getByAltText(/Image 3 of 3/i)).toBeInTheDocument();
  });

  // Empty urls array — the lightbox renders nothing (parents may pass [] briefly).
  it("renders nothing when urls is empty", () => {
    const { container } = render(<ImageLightbox urls={[]} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  // Caption shows up next to the position counter.
  it("renders the caption for the current image", () => {
    render(
      <ImageLightbox
        urls={URLS}
        startIndex={0}
        captions={["First caption", "Second caption", undefined]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("First caption")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByText("Second caption")).toBeInTheDocument();
  });

  // Axe accessibility scan: dialog has accessible name, buttons have labels,
  // images have alt text. Run with one image (no carousel chrome).
  it("passes axe accessibility checks", async () => {
    const { axe } = await import("vitest-axe");
    const { container } = render(<ImageLightbox urls={["/only.png"]} onClose={() => {}} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // Axe accessibility scan with carousel chrome (multi-image case).
  it("passes axe accessibility checks with carousel chrome", async () => {
    const { axe } = await import("vitest-axe");
    const { container } = render(<ImageLightbox urls={URLS} onClose={() => {}} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

import { useCallback, useEffect, useRef, useState } from "react";

interface ImageLightboxProps {
  urls: string[];
  /** Starting image index. Clamped to a valid range. */
  startIndex?: number;
  onClose: () => void;
  /** Optional captions, parallel to urls. */
  captions?: (string | undefined)[];
}

/**
 * Fullscreen image viewer for browsing one or more media attachments.
 *
 * Keyboard: Escape closes, ArrowLeft/ArrowRight navigate, Home/End jump.
 * Backdrop click closes; clicks on the image or controls do not propagate.
 * Auto-focuses the close button so screen readers and keyboard users can
 * dismiss without hunting.
 */
export function ImageLightbox({ urls, startIndex = 0, onClose, captions }: ImageLightboxProps) {
  const safeUrls = urls.filter(Boolean);
  const clampedStart = Math.max(0, Math.min(startIndex, safeUrls.length - 1));
  const [index, setIndex] = useState(clampedStart);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const hasMultiple = safeUrls.length > 1;

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + safeUrls.length) % safeUrls.length);
  }, [safeUrls.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % safeUrls.length);
  }, [safeUrls.length]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" && hasMultiple) {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight" && hasMultiple) {
        e.preventDefault();
        goNext();
      } else if (e.key === "Home" && hasMultiple) {
        e.preventDefault();
        setIndex(0);
      } else if (e.key === "End" && hasMultiple) {
        e.preventDefault();
        setIndex(safeUrls.length - 1);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [goPrev, goNext, hasMultiple, onClose, safeUrls.length]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  if (safeUrls.length === 0) return null;

  const currentUrl = safeUrls[index];
  const currentCaption = captions?.[index];

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer, image ${index + 1} of ${safeUrls.length}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close image viewer"
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-xl transition-colors focus:outline-none focus:ring-2 focus:ring-white"
      >
        &#x2715;
      </button>

      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            aria-label="Previous image"
            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl transition-colors focus:outline-none focus:ring-2 focus:ring-white"
          >
            &#x2039;
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            aria-label="Next image"
            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl transition-colors focus:outline-none focus:ring-2 focus:ring-white"
          >
            &#x203A;
          </button>
        </>
      )}

      <div
        className="flex flex-col items-center max-w-[95vw] max-h-[95vh] gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={currentUrl}
          alt={currentCaption || `Image ${index + 1} of ${safeUrls.length}`}
          className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl"
        />
        {(hasMultiple || currentCaption) && (
          <div className="text-white text-xs flex items-center gap-3 bg-black/40 px-3 py-1.5 rounded-full">
            {hasMultiple && <span aria-live="polite">{index + 1} / {safeUrls.length}</span>}
            {currentCaption && <span className="opacity-80 max-w-md truncate">{currentCaption}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

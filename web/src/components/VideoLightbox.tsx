import { useEffect, useRef } from "react";

interface VideoLightboxProps {
  /** The video URL to play. */
  url: string;
  /** Optional poster/thumbnail shown before playback. */
  poster?: string;
  onClose: () => void;
}

/**
 * Fullscreen video viewer — a popup for watching a draft/reel video larger.
 *
 * Escape or a backdrop click closes it; clicks on the video/controls do not
 * propagate. Auto-focuses the close button and locks body scroll while open.
 * The video autoplays (muted) so the popup is immediately useful.
 */
export function VideoLightbox({ url, poster, onClose }: VideoLightboxProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  if (!url) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Video viewer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close video viewer"
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-xl transition-colors focus:outline-none focus:ring-2 focus:ring-white"
      >
        &#x2715;
      </button>

      <div className="flex flex-col items-center max-w-[95vw] max-h-[95vh]" onClick={(e) => e.stopPropagation()}>
        <video
          src={url}
          poster={poster}
          controls
          autoPlay
          playsInline
          data-testid="video-lightbox-player"
          className="max-w-[95vw] max-h-[85vh] rounded-md shadow-2xl bg-black"
        />
      </div>
    </div>
  );
}

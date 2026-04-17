import { useState, useEffect } from "react";
import { api } from "../api.js";

interface MediaFile {
  filename: string;
  path: string;
}

export function MediaPage({ embedded }: { embedded?: boolean }) {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listMedia()
      .then((res) => setMediaFiles(res.files))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-cc-bg">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 sm:py-10 pb-safe">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-cc-fg">Media</h1>
          <p className="text-xs text-cc-muted mt-1">
            Images and files created by agents and Gemini Live.
          </p>
        </div>

        {loading ? (
          <p className="text-xs text-cc-muted">Loading...</p>
        ) : mediaFiles.length === 0 ? (
          <div className="text-center py-16">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-8 h-8 text-cc-muted/30 mx-auto mb-3">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <circle cx="5.5" cy="5.5" r="1" />
              <path d="M2 11l3-3 2 2 3-4 4 5" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" strokeWidth="1" fill="none" />
            </svg>
            <p className="text-sm text-cc-muted">No media files yet</p>
            <p className="text-xs text-cc-muted mt-1">
              Generated images from agents and Gemini will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {mediaFiles.map((file, i) => (
              <a
                key={i}
                href={`/api/media/file/${encodeURIComponent(file.filename)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group bg-cc-card border border-cc-border rounded-xl overflow-hidden hover:border-cc-primary/40 transition-colors"
              >
                <img
                  src={`/api/media/file/${encodeURIComponent(file.filename)}`}
                  alt={file.filename}
                  className="w-full aspect-square object-cover"
                  loading="lazy"
                />
                <div className="px-2.5 py-2">
                  <p className="text-[11px] text-cc-muted truncate group-hover:text-cc-fg transition-colors">
                    {file.filename}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

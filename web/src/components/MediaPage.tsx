import { useState } from "react";
import { api } from "../api.js";

interface GeneratedImage {
  filename: string;
  path: string;
  mimeType: string;
  prompt: string;
  model: string;
}

interface MediaFile {
  filename: string;
  path: string;
}

export function MediaPage({ embedded }: { embedded?: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [showGallery, setShowGallery] = useState(false);

  async function handleGenerate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError("");
    try {
      const res = await api.generateImage(prompt.trim());
      setResults((prev) => [...res.images, ...prev]);
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function loadGallery() {
    try {
      const res = await api.listMedia();
      setMediaFiles(res.files);
      setShowGallery(true);
    } catch {
      // silent
    }
  }

  return (
    <div className={`h-full overflow-auto ${embedded ? "" : ""}`}>
      <div className="max-w-3xl mx-auto px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-cc-fg">Media Generation</h1>
          <p className="text-xs text-cc-muted mt-1">
            Generate images using the Gemini API.
          </p>
        </div>

        {/* Prompt input */}
        <div className="bg-cc-card border border-cc-border rounded-xl p-4 mb-6">
          <div className="flex gap-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              placeholder="Describe the image you want to generate..."
              rows={3}
              className="flex-1 text-sm bg-transparent resize-none focus:outline-none text-cc-fg placeholder:text-cc-muted/70"
            />
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || generating}
              className="self-end px-4 py-2 rounded-lg text-xs font-medium bg-cc-primary text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating...
                </span>
              ) : (
                "Generate"
              )}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-cc-error/5 border border-cc-error/20">
            <p className="text-xs text-cc-error">{error}</p>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-cc-muted uppercase tracking-wider mb-3">Generated</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {results.map((img, i) => (
                <div key={i} className="bg-cc-card border border-cc-border rounded-xl overflow-hidden">
                  <img
                    src={`/media/file/${encodeURIComponent(img.filename)}`}
                    alt={img.prompt}
                    className="w-full aspect-square object-cover"
                  />
                  <div className="px-3 py-2">
                    <p className="text-[11px] text-cc-muted truncate" title={img.prompt}>{img.prompt}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Gallery toggle */}
        <div className="border-t border-cc-border pt-4">
          {!showGallery ? (
            <button
              onClick={loadGallery}
              className="text-xs text-cc-primary hover:text-cc-primary/80 transition-colors cursor-pointer"
            >
              Browse media gallery
            </button>
          ) : (
            <>
              <h2 className="text-xs font-semibold text-cc-muted uppercase tracking-wider mb-3">Gallery</h2>
              {mediaFiles.length === 0 ? (
                <p className="text-xs text-cc-muted">No media files yet.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {mediaFiles.map((file, i) => (
                    <a
                      key={i}
                      href={`/media/file/${encodeURIComponent(file.filename)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-cc-card border border-cc-border rounded-lg overflow-hidden hover:border-cc-primary/50 transition-colors"
                    >
                      <img
                        src={`/media/file/${encodeURIComponent(file.filename)}`}
                        alt={file.filename}
                        className="w-full aspect-square object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

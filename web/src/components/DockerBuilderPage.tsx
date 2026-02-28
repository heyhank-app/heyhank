import { useState, useEffect, useCallback, useRef } from "react";
import { api, type CompanionEnv, type ImagePullState } from "../api.js";

/** Max poll attempts before declaring a build timeout (5 min at 2s intervals) */
const MAX_BUILD_POLLS = 150;

export function DockerBuilderPage() {
  // Docker availability
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null);
  const [availableImages, setAvailableImages] = useState<string[]>([]);

  // Build status
  const [buildState, setBuildState] = useState<"idle" | "building" | "success" | "error">("idle");
  const [buildLog, setBuildLog] = useState("");
  const [buildError, setBuildError] = useState("");
  const [lastBuiltTag, setLastBuiltTag] = useState("");
  const [lastBuiltAt, setLastBuiltAt] = useState<number | null>(null);

  // Image pull state tracking
  const [imageStates, setImageStates] = useState<Record<string, ImagePullState>>({});
  const pullPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Envs for building (we allow building for any env that has a dockerfile)
  const [envs, setEnvs] = useState<CompanionEnv[]>([]);
  const [selectedEnvSlug, setSelectedEnvSlug] = useState<string>("");

  // Guard against setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const selectedEnv = envs.find((e) => e.slug === selectedEnvSlug);

  const refreshImageStatus = useCallback((tag: string) => {
    api.getImageStatus(tag).then((state) => {
      if (mountedRef.current) setImageStates((prev) => ({ ...prev, [tag]: state }));
    }).catch(() => {});
  }, []);

  const handlePullImage = useCallback((tag: string) => {
    api.pullImage(tag).then((res) => {
      if (mountedRef.current && res.state) {
        setImageStates((prev) => ({ ...prev, [tag]: res.state }));
      }
    }).catch(() => {});
  }, []);

  // Poll pulling images
  const pullingImagesRef = useRef<string[]>([]);
  useEffect(() => {
    const pullingImages = Object.entries(imageStates)
      .filter(([, s]) => s.status === "pulling")
      .map(([tag]) => tag);
    pullingImagesRef.current = pullingImages;

    if (pullingImages.length === 0) {
      if (pullPollRef.current) {
        clearInterval(pullPollRef.current);
        pullPollRef.current = null;
      }
      return;
    }

    if (!pullPollRef.current) {
      pullPollRef.current = setInterval(() => {
        for (const tag of pullingImagesRef.current) {
          refreshImageStatus(tag);
        }
      }, 2000);
    }

    return () => {
      if (pullPollRef.current) {
        clearInterval(pullPollRef.current);
        pullPollRef.current = null;
      }
    };
  }, [imageStates, refreshImageStatus]);

  const refreshImages = useCallback(() => {
    api.getContainerImages().then(setAvailableImages).catch(() => {});
  }, []);

  useEffect(() => {
    api.getContainerStatus().then((s) => {
      setDockerAvailable(s.available);
      if (s.available) {
        refreshImages();
      }
    }).catch(() => setDockerAvailable(false));

    api.listEnvs().then(setEnvs).catch(() => {});
  }, [refreshImages]);

  // Check image status for all available images on mount
  useEffect(() => {
    if (!dockerAvailable) return;
    for (const img of availableImages) {
      refreshImageStatus(img);
    }
  }, [availableImages, dockerAvailable, refreshImageStatus]);

  const pollCountRef = useRef(0);
  // Token ref to cancel in-flight poll chains when the env changes.
  // Each handleBuild() call creates a new token; stale polls from a
  // previous build bail out when their captured token no longer matches.
  const buildTokenRef = useRef<object | null>(null);

  // Reset build state when environment selection changes so stale results
  // from a previous env don't carry over to the newly selected env.
  useEffect(() => {
    buildTokenRef.current = null; // cancel any in-flight poll chain
    setBuildState("idle");
    setBuildLog("");
    setBuildError("");
    setLastBuiltTag("");
    setLastBuiltAt(null);
    pollCountRef.current = 0;
  }, [selectedEnvSlug]);

  async function handleBuild() {
    if (!selectedEnvSlug) return;
    const token = {};
    buildTokenRef.current = token;
    setBuildState("building");
    setBuildLog("Starting build...\n");
    setBuildError("");
    pollCountRef.current = 0;
    try {
      await api.buildEnvImage(selectedEnvSlug);
      const poll = async () => {
        if (!mountedRef.current || buildTokenRef.current !== token) return;
        if (pollCountRef.current++ >= MAX_BUILD_POLLS) {
          setBuildState("error");
          setBuildError("Build timed out after 5 minutes");
          setBuildLog((prev) => prev + "\nBuild timed out.");
          return;
        }
        try {
          const status = await api.getEnvBuildStatus(selectedEnvSlug);
          if (!mountedRef.current || buildTokenRef.current !== token) return;
          if (status.buildStatus === "building") {
            setTimeout(poll, 2000);
          } else {
            if (status.buildStatus === "success") {
              setBuildState("success");
              setBuildLog((prev) => prev + "\nBuild successful!");
              setLastBuiltTag(status.imageTag || "");
              setLastBuiltAt(status.lastBuiltAt || Date.now());
              refreshImages();
              api.listEnvs().then((e) => { if (mountedRef.current) setEnvs(e); }).catch(() => {});
            } else {
              setBuildState("error");
              setBuildError(status.buildError || "Unknown error");
              setBuildLog((prev) => prev + `\nBuild failed: ${status.buildError || "Unknown error"}`);
            }
          }
        } catch (pollErr: unknown) {
          if (!mountedRef.current || buildTokenRef.current !== token) return;
          const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
          setBuildState("error");
          setBuildError(msg);
          setBuildLog((prev) => prev + `\nPoll error: ${msg}`);
        }
      };
      setTimeout(poll, 2000);
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setBuildState("error");
      const msg = e instanceof Error ? e.message : String(e);
      setBuildError(msg);
      setBuildLog((prev) => prev + `\nBuild error: ${msg}`);
    }
  }

  const dockerBadge = dockerAvailable === null ? null : dockerAvailable ? (
    <span className="text-[10px] px-2 py-1 rounded-md bg-green-500/10 text-green-500 font-medium">Docker</span>
  ) : (
    <span className="text-[10px] px-2 py-1 rounded-md bg-amber-500/10 text-amber-500 font-medium">No Docker</span>
  );

  const envsWithDockerfile = envs.filter((e) => e.dockerfile);

  // Derive read-only display values from the selected env
  const displayImageTag = selectedEnv?.imageTag || (selectedEnvSlug ? `companion-env-${selectedEnvSlug}:latest` : "");
  const displayBaseImage = selectedEnv?.baseImage || "";
  const displayDockerfile = selectedEnv?.dockerfile || "";

  return (
    <div className="h-full bg-cc-bg text-cc-fg font-sans-ui antialiased overflow-y-auto overflow-x-hidden">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-safe">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-cc-fg">Docker Builder</h1>
            <p className="mt-0.5 text-[13px] text-cc-muted leading-relaxed">
              Build and manage Docker images for environments.
            </p>
          </div>
          {dockerBadge}
        </div>

        {/* Build Card */}
        <div className="mt-6 rounded-xl bg-cc-card p-4 sm:p-5 space-y-4">
          <h2 className="text-sm font-semibold text-cc-fg">Build Image</h2>

          {/* Environment selector */}
          <div>
            <label className="block text-[11px] text-cc-muted mb-1">Environment</label>
            <select
              aria-label="Environment"
              value={selectedEnvSlug}
              onChange={(e) => setSelectedEnvSlug(e.target.value)}
              disabled={!dockerAvailable}
              className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg focus:outline-none focus:ring-1 focus:ring-cc-primary/40 transition-shadow disabled:opacity-50"
            >
              <option value="">Select an environment with a Dockerfile</option>
              {envsWithDockerfile.map((env) => (
                <option key={env.slug} value={env.slug}>{env.name}</option>
              ))}
            </select>
            {envs.length > 0 && envsWithDockerfile.length === 0 && (
              <p className="mt-1.5 text-[11px] text-cc-muted">
                No environments have a Dockerfile configured. Add one in the{" "}
                <a href="#/environments" className="text-cc-primary hover:underline">Environments</a> page.
              </p>
            )}
          </div>

          {/* Read-only env details shown when an env is selected */}
          {selectedEnv && (
            <>
              {/* Image tag (read-only — determined by server) */}
              <div>
                <label className="block text-[11px] text-cc-muted mb-1">Image Tag</label>
                <div className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg font-mono-code opacity-70">
                  {displayImageTag}
                </div>
              </div>

              {/* Base image (read-only) */}
              {displayBaseImage && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-cc-muted">Base Image</label>
                    {imageStates[displayBaseImage]?.status === "ready" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">Ready</span>
                    )}
                    {imageStates[displayBaseImage]?.status === "pulling" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 flex items-center gap-1">
                        <span className="w-2.5 h-2.5 border border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
                        Pulling...
                      </span>
                    )}
                  </div>
                  <div className="w-full px-3 py-2.5 min-h-[44px] text-sm bg-cc-bg rounded-lg text-cc-fg font-mono-code opacity-70">
                    {displayBaseImage}
                  </div>
                </div>
              )}

              {/* Dockerfile (read-only preview) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-cc-muted">Dockerfile</label>
                  <a
                    href="#/environments"
                    className="text-[10px] text-cc-primary hover:underline"
                  >
                    Edit in Environments
                  </a>
                </div>
                <pre className="w-full px-3 py-2.5 text-[11px] font-mono-code bg-cc-bg rounded-lg text-cc-fg max-h-[200px] overflow-auto whitespace-pre-wrap opacity-70">
                  {displayDockerfile}
                </pre>
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {displayBaseImage && selectedEnv && (
              <button
                onClick={() => handlePullImage(displayBaseImage)}
                disabled={!dockerAvailable || imageStates[displayBaseImage]?.status === "pulling"}
                className={`px-3 py-2.5 min-h-[44px] text-xs font-medium rounded-lg transition-colors ${
                  !dockerAvailable || imageStates[displayBaseImage]?.status === "pulling"
                    ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                    : "bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer"
                }`}
              >
                {imageStates[displayBaseImage]?.status === "pulling"
                  ? "Pulling..."
                  : imageStates[displayBaseImage]?.status === "ready"
                    ? "Pull / Update base image"
                    : "Pull base image"}
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={handleBuild}
              disabled={!dockerAvailable || !selectedEnvSlug || buildState === "building"}
              className={`px-4 py-2.5 min-h-[44px] text-sm font-medium rounded-lg transition-colors ${
                dockerAvailable && selectedEnvSlug && buildState !== "building"
                  ? "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                  : "bg-cc-hover text-cc-muted cursor-not-allowed"
              }`}
            >
              {buildState === "building" ? "Building..." : "Build Image"}
            </button>
          </div>
        </div>

        {/* Build Status Panel */}
        <div className="mt-4 rounded-xl bg-cc-card p-4 sm:p-5 space-y-3">
          <h2 className="text-sm font-semibold text-cc-fg">Build Status</h2>
          {buildState === "idle" && (
            <p className="text-xs text-cc-muted">No build in progress.</p>
          )}
          {buildState === "building" && (
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-cc-primary/30 border-t-cc-primary rounded-full animate-spin" />
              <span className="text-xs text-cc-fg">Building...</span>
            </div>
          )}
          {buildState === "success" && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">Success</span>
              {lastBuiltTag && <span className="text-xs text-cc-muted font-mono-code">{lastBuiltTag}</span>}
              {lastBuiltAt && <span className="text-[10px] text-cc-muted">{new Date(lastBuiltAt).toLocaleString()}</span>}
            </div>
          )}
          {buildState === "error" && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-error/10 text-cc-error">Error</span>
                <span className="text-xs text-cc-error">{buildError}</span>
              </div>
              <button
                onClick={handleBuild}
                disabled={!selectedEnvSlug}
                className="text-xs text-cc-primary hover:underline cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}
          {buildLog && (
            <div className="relative">
              <button
                onClick={() => { setBuildLog(""); setBuildState("idle"); setBuildError(""); }}
                aria-label="Clear log"
                className="absolute top-1 right-1 text-cc-muted hover:text-cc-fg cursor-pointer p-1"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </button>
              <pre className="px-3 py-2 text-[10px] font-mono-code bg-cc-code-bg rounded-lg text-cc-muted max-h-[200px] overflow-auto whitespace-pre-wrap">
                {buildLog}
              </pre>
            </div>
          )}
        </div>

        {/* Available Images List */}
        <div className="mt-4 rounded-xl bg-cc-card p-4 sm:p-5 space-y-3">
          <h2 className="text-sm font-semibold text-cc-fg">Available Images</h2>
          {!dockerAvailable && dockerAvailable !== null && (
            <p className="text-xs text-amber-500">Docker is not available. Install Docker to manage images.</p>
          )}
          {dockerAvailable && availableImages.length === 0 && (
            <p className="text-xs text-cc-muted">No images found locally.</p>
          )}
          {dockerAvailable && availableImages.length > 0 && (
            <div className="space-y-1">
              {availableImages.map((img) => {
                const state = imageStates[img];
                const isPulling = state?.status === "pulling";
                return (
                  <div
                    key={img}
                    className="flex items-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg hover:bg-cc-hover/60 transition-colors"
                  >
                    <span className="flex-1 text-xs font-mono-code text-cc-fg truncate">{img}</span>
                    {state?.status === "ready" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">Ready</span>
                    )}
                    {state?.status === "pulling" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 flex items-center gap-1">
                        <span className="w-2.5 h-2.5 border border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
                        Pulling...
                      </span>
                    )}
                    {state?.status === "error" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-error/10 text-cc-error">Error</span>
                    )}
                    <button
                      onClick={() => handlePullImage(img)}
                      disabled={isPulling}
                      className={`text-xs px-2.5 py-1.5 min-h-[44px] rounded transition-colors ${
                        isPulling
                          ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                          : "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 cursor-pointer"
                      }`}
                    >
                      {isPulling ? "Pulling..." : state?.status === "ready" ? "Update" : "Pull"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

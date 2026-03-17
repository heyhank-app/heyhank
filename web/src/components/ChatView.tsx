import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { captureException } from "../analytics.js";
import { MessageFeed } from "./MessageFeed.js";
import { Composer } from "./Composer.js";
import { PermissionBanner } from "./PermissionBanner.js";
import { AiValidationBadge } from "./AiValidationBadge.js";

export function ChatView({ sessionId }: { sessionId: string }) {
  const sessionPerms = useStore((s) => s.pendingPermissions.get(sessionId));
  const aiResolved = useStore((s) => s.aiResolvedPermissions.get(sessionId));
  const clearAiResolvedPermissions = useStore((s) => s.clearAiResolvedPermissions);
  const connStatus = useStore(
    (s) => s.connectionStatus.get(sessionId) ?? "disconnected"
  );
  const cliConnected = useStore((s) => s.cliConnected.get(sessionId) ?? false);
  const cliReconnecting = useStore(
    (s) => s.cliReconnecting.get(sessionId) ?? false
  );
  const setCliReconnecting = useStore((s) => s.setCliReconnecting);

  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clear stale error when switching sessions or when CLI reconnects
  useEffect(() => {
    setReconnectError(null);
    clearTimeout(errorTimerRef.current);
  }, [sessionId, cliConnected]);

  // Clean up error auto-clear timer on unmount
  useEffect(() => () => clearTimeout(errorTimerRef.current), []);

  const handleReconnect = useCallback(async () => {
    setReconnectError(null);
    clearTimeout(errorTimerRef.current);
    setCliReconnecting(sessionId, true);
    try {
      await api.relaunchSession(sessionId);
    } catch (err) {
      captureException(err);
      setCliReconnecting(sessionId, false);
      const msg =
        err instanceof Error ? err.message : "Reconnection failed";
      setReconnectError(msg);
      errorTimerRef.current = setTimeout(() => setReconnectError(null), 4000);
    }
  }, [sessionId, setCliReconnecting]);

  const perms = useMemo(
    () => (sessionPerms ? Array.from(sessionPerms.values()) : []),
    [sessionPerms]
  );

  const showCliBanner = connStatus === "connected" && !cliConnected;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* CLI disconnected / reconnecting / error banner */}
      {showCliBanner && (
        <div className="px-4 py-2 bg-cc-warning/10 border-b border-cc-warning/20 text-center flex items-center justify-center gap-3">
          {reconnectError ? (
            <>
              <span className="text-xs text-cc-error font-medium">
                {reconnectError}
              </span>
              <button
                onClick={handleReconnect}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-cc-error/15 hover:bg-cc-error/25 text-cc-error transition-colors cursor-pointer"
              >
                Retry
              </button>
            </>
          ) : cliReconnecting ? (
            <>
              <span className="w-3 h-3 rounded-full border-2 border-cc-warning/30 border-t-cc-warning animate-spin" />
              <span className="text-xs text-cc-warning font-medium">
                Reconnecting&hellip;
              </span>
            </>
          ) : (
            <>
              <span className="text-xs text-cc-warning font-medium">
                CLI disconnected
              </span>
              <button
                onClick={handleReconnect}
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-cc-warning/20 hover:bg-cc-warning/30 text-cc-warning transition-colors cursor-pointer"
              >
                Reconnect
              </button>
            </>
          )}
        </div>
      )}

      {/* WebSocket disconnected banner */}
      {connStatus === "disconnected" && (
        <div className="px-4 py-2 bg-cc-warning/10 border-b border-cc-warning/20 text-center">
          <span className="text-xs text-cc-warning font-medium">
            Reconnecting to session...
          </span>
        </div>
      )}

      {/* Message feed */}
      <MessageFeed sessionId={sessionId} />

      {/* AI auto-resolved notification (most recent only) */}
      {aiResolved && aiResolved.length > 0 && (
        <div className="shrink-0 border-t border-cc-border bg-cc-card">
          <AiValidationBadge
            entry={aiResolved[aiResolved.length - 1]}
            onDismiss={() => clearAiResolvedPermissions(sessionId)}
          />
        </div>
      )}

      {/* Permission banners */}
      {perms.length > 0 && (
        <div className="shrink-0 max-h-[60dvh] overflow-y-auto border-t border-cc-border bg-cc-card">
          {perms.map((p) => (
            <PermissionBanner key={p.request_id} permission={p} sessionId={sessionId} />
          ))}
        </div>
      )}

      {/* Composer */}
      <Composer sessionId={sessionId} />
    </div>
  );
}

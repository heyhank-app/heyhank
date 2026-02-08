import { useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { Approval } from "../types.js";

export function ApprovalBanner({ approval }: { approval: Approval }) {
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const removeApproval = useStore((s) => s.removeApproval);

  const isPlan = approval.type === "plan";

  async function handleAction(approve: boolean) {
    setLoading(true);
    try {
      await api.approve(
        approval.agent,
        approval.id,
        approval.type,
        approve,
        isPlan && !approve ? feedback || undefined : undefined,
      );
      removeApproval(approval.id);
    } catch (e: any) {
      alert(e.message);
    }
    setLoading(false);
  }

  return (
    <div
      className={`mx-4 mt-2 rounded-xl border overflow-hidden ${
        isPlan
          ? "bg-amber-500/5 border-amber-500/20"
          : "bg-cyan-500/5 border-cyan-500/20"
      }`}
    >
      {/* Left accent bar via inner flex layout */}
      <div className="flex">
        <div
          className={`w-1 shrink-0 ${
            isPlan ? "bg-amber-500/60" : "bg-cyan-500/60"
          }`}
        />
        <div className="flex-1 p-3.5">
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2">
              {/* Type icon */}
              {isPlan ? (
                <div className="w-6 h-6 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-amber-400">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                    <rect x="9" y="3" width="6" height="4" rx="1" />
                  </svg>
                </div>
              ) : (
                <div className="w-6 h-6 rounded-md bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-cyan-400">
                    <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
              )}
              <div>
                <span
                  className={`text-xs font-semibold ${
                    isPlan ? "text-amber-400" : "text-cyan-400"
                  }`}
                >
                  {isPlan ? "Plan Approval Request" : "Permission Request"}
                </span>
                <span className="text-[10px] text-gray-500 ml-2">
                  from {approval.agent}
                </span>
              </div>
            </div>
          </div>

          {isPlan && approval.planContent && (
            <pre className="text-xs text-gray-300 bg-gray-950/60 rounded-lg p-3 mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed border border-gray-800/60">
              {approval.planContent}
            </pre>
          )}

          {!isPlan && (
            <p className="text-xs text-gray-300 mb-3">
              <span className="font-medium text-cyan-300">{approval.toolName}</span>
              {approval.description && (
                <span className="text-gray-400"> -- {approval.description}</span>
              )}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleAction(true)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600/80 hover:bg-emerald-500/80 border border-emerald-500/30 disabled:opacity-50 transition-all cursor-pointer"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
                <path d="M3 8.5l3.5 3.5 6.5-7" />
              </svg>
              Approve
            </button>
            <button
              onClick={() => handleAction(false)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-700/60 hover:bg-gray-600/60 border border-gray-600/30 text-gray-300 hover:text-gray-100 disabled:opacity-50 transition-all cursor-pointer"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
              Reject
            </button>
            {isPlan && (
              <input
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Feedback (optional, for rejection)"
                className="flex-1 px-3 py-1.5 text-xs bg-gray-800/60 border border-gray-700/50 rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-500/40 transition-all"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

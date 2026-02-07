import { useState, useRef } from "react";
import { api } from "../api.js";

export function MessageInput({ agentName }: { agentName: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleSend() {
    const msg = text.trim();
    if (!msg || sending) return;

    setSending(true);
    try {
      await api.sendMessage(agentName, msg);
      setText("");
      textareaRef.current?.focus();
    } catch (e: any) {
      alert(e.message);
    }
    setSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend = text.trim().length > 0 && !sending;

  return (
    <div className="px-4 py-3 bg-gray-950/60 backdrop-blur-sm border-t border-gray-800/80 shadow-[0_-1px_3px_rgba(0,0,0,0.2)] shrink-0">
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={2}
            className="w-full px-3.5 py-2.5 text-sm bg-gray-900/80 border border-gray-700/60 rounded-xl resize-none focus:outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.1),inset_0_1px_4px_rgba(59,130,246,0.05)] text-gray-100 font-mono placeholder:text-gray-600 transition-all duration-200"
          />
          <span className="absolute right-3 bottom-2 text-[10px] text-gray-600 font-mono pointer-events-none select-none">
            Enter to send
          </span>
        </div>
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 ${
            canSend
              ? "bg-blue-600 hover:bg-blue-500 text-white shadow-[0_1px_4px_rgba(59,130,246,0.3)] hover:shadow-[0_2px_8px_rgba(59,130,246,0.4)]"
              : "bg-gray-800/50 text-gray-600 cursor-not-allowed"
          }`}
          title="Send message"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4.5 h-4.5">
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

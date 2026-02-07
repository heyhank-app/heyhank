import type { Message } from "../types.js";

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.from === "you";
  const isSystem = message.isSystem;

  if (isSystem) {
    return (
      <div className="flex items-center gap-3 py-1.5">
        <div className="flex-1 h-px bg-gray-800/60" />
        <span className="text-[10px] text-gray-600 italic font-mono shrink-0 px-1">
          {message.text}
        </span>
        <div className="flex-1 h-px bg-gray-800/60" />
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-[fadeSlideIn_0.2s_ease-out]`}>
      <div
        className={`relative max-w-[80%] px-3.5 py-2.5 ${
          isUser
            ? "bg-gradient-to-br from-blue-600/20 to-blue-500/10 border border-blue-500/20 rounded-2xl rounded-br-md shadow-[0_1px_6px_rgba(59,130,246,0.08)]"
            : "bg-gray-800/80 border border-gray-700/50 rounded-2xl rounded-bl-md shadow-[0_1px_4px_rgba(0,0,0,0.2)]"
        }`}
      >
        {/* Left accent bar for agent messages */}
        {!isUser && (
          <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-emerald-500/40" />
        )}
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`text-[10px] font-semibold tracking-wide uppercase ${
              isUser ? "text-blue-400/70" : "text-emerald-400/70"
            }`}
          >
            {message.from}
          </span>
          <span className="text-[10px] text-gray-600 font-mono tabular-nums">
            {formatTime(message.timestamp)}
          </span>
        </div>
        <pre className="text-[13px] text-gray-200 whitespace-pre-wrap break-words font-mono leading-relaxed">
          {message.text}
        </pre>
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { useStore } from "../store.js";
import { MessageBubble } from "./MessageBubble.js";

export function MessageFeed({ agentName }: { agentName: string }) {
  const messages = useStore((s) => s.messages.get(agentName) || []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottom = useRef(true);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 100;
    isNearBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }

  useEffect(() => {
    if (isNearBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500 select-none">
        <svg viewBox="0 0 48 48" fill="none" className="w-12 h-12 text-gray-700">
          <rect x="4" y="6" width="40" height="30" rx="4" stroke="currentColor" strokeWidth="2" />
          <path d="M4 32L16 22L24 28L32 20L44 30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0" />
          <text x="14" y="26" fill="currentColor" fontSize="10" fontFamily="monospace" opacity="0.5">&gt;_</text>
          <circle cx="36" cy="42" r="5" stroke="currentColor" strokeWidth="2" opacity="0.3" />
          <path d="M39.5 45.5L43 49" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
        </svg>
        <div className="text-center">
          <p className="text-sm text-gray-500 font-medium">No messages yet</p>
          <p className="text-xs text-gray-600 mt-1">Send a message to start the conversation</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      {/* Top fade gradient */}
      <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-gray-950 to-transparent z-10 pointer-events-none" />
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto scroll-smooth px-4 py-4 space-y-3"
      >
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

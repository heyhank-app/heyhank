import { FadeIn } from "./FadeIn";

const features = [
  {
    title: "Multiple Sessions",
    description: "Run several Claude Code instances side by side. Each gets its own process, model, and permission settings.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="M12 10V3" />
      </svg>
    ),
  },
  {
    title: "Real-time Streaming",
    description: "Responses render token by token. See what the agent is writing as it writes it.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    title: "Tool Call Visibility",
    description: "Every Bash command, file read, edit, and search displayed in collapsible blocks with syntax highlighting.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
        <line x1="14" y1="4" x2="10" y2="20" />
      </svg>
    ),
  },
  {
    title: "Subagent Nesting",
    description: "When agents spawn sub-agents, their work renders hierarchically so you can follow the full chain.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M6 21V9a9 9 0 0 0 9 9" />
      </svg>
    ),
  },
  {
    title: "Permission Control",
    description: "Four modes from auto-approve everything to manual approval for each individual tool call.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    title: "Session Persistence",
    description: "Sessions save to disk and auto-recover after server restarts or CLI crashes.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
      </svg>
    ),
  },
];

export function Features() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-[960px] mx-auto">
        <h2 className="font-serif-display text-[clamp(24px,4vw,32px)] font-bold text-center mb-12 tracking-tight">
          Everything you need
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => (
            <FadeIn key={f.title}>
              <div className="bg-cc-card border border-cc-border rounded-[14px] p-7 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md h-full">
                <div className="w-9 h-9 rounded-[10px] bg-cc-primary/12 flex items-center justify-center mb-4">
                  <div className="w-[18px] h-[18px] text-cc-primary">{f.icon}</div>
                </div>
                <h3 className="text-[15px] font-semibold mb-1.5">{f.title}</h3>
                <p className="text-sm text-cc-muted leading-relaxed">{f.description}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

import { FadeIn } from "./FadeIn";

export function HowItWorks() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-[960px] mx-auto">
        <h2 className="font-serif-display text-[clamp(24px,4vw,32px)] font-bold text-center mb-12 tracking-tight">
          How it works
        </h2>

        <FadeIn>
          <div className="flex items-center justify-center gap-4 mb-12 flex-wrap">
            <div className="bg-cc-card border border-cc-border rounded-[10px] px-5 py-3.5 text-sm font-medium whitespace-nowrap">
              Claude Code CLI
            </div>
            <span className="text-cc-muted font-mono-code text-xs">&larr; WebSocket &rarr;</span>
            <div className="bg-cc-card border-2 border-cc-primary rounded-[10px] px-5 py-3.5 text-sm font-medium whitespace-nowrap">
              Companion Server
            </div>
            <span className="text-cc-muted font-mono-code text-xs">&larr; WebSocket &rarr;</span>
            <div className="bg-cc-card border border-cc-border rounded-[10px] px-5 py-3.5 text-sm font-medium whitespace-nowrap">
              Your Browser
            </div>
          </div>
        </FadeIn>

        <FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-[800px] mx-auto">
            {[
              {
                step: 1,
                title: "Install & run",
                description: (
                  <>
                    Run <code className="font-mono-code text-xs bg-cc-code-bg text-cc-code-fg px-1.5 py-0.5 rounded">bunx the-vibe-companion</code> in
                    your terminal.
                  </>
                ),
              },
              {
                step: 2,
                title: "Bridge",
                description: "The server spawns Claude Code processes and bridges their WebSocket connections to your browser.",
              },
              {
                step: 3,
                title: "Code",
                description: "You get streaming output, tool call visibility, and permission control — all in your browser.",
              },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div className="w-8 h-8 rounded-full bg-cc-primary text-white inline-flex items-center justify-center text-sm font-semibold mb-3">
                  {s.step}
                </div>
                <h3 className="text-[15px] font-semibold mb-1.5">{s.title}</h3>
                <p className="text-sm text-cc-muted leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

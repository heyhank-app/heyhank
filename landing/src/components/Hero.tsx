import { ClawdLogo } from "./ClawdLogo";
import { InstallBlock } from "./InstallBlock";

export function Hero() {
  return (
    <section className="text-center pt-20 pb-16 px-6">
      <div className="max-w-[960px] mx-auto">
        <div className="animate-mascot mb-8 inline-block">
          <ClawdLogo size={80} />
        </div>

        <h1 className="font-serif-display text-[clamp(36px,6vw,56px)] font-bold tracking-tight leading-[1.1] mb-5 animate-fade-up-1">
          Claude Code, in your browser.
        </h1>

        <p className="text-[clamp(16px,2.5vw,19px)] text-cc-muted max-w-[560px] mx-auto mb-10 leading-relaxed animate-fade-up-2">
          A web UI that reverse-engineers Claude Code's WebSocket protocol.
          Multiple sessions, real-time streaming, visual tool calls. No API key needed.
        </p>

        <div className="animate-fade-up-3">
          <InstallBlock />
        </div>

        <p className="mt-3.5 text-sm text-cc-muted animate-fade-up-4">
          Then open{" "}
          <code className="font-mono-code text-[13px] bg-cc-border px-1.5 py-0.5 rounded">
            localhost:3456
          </code>
        </p>
      </div>
    </section>
  );
}

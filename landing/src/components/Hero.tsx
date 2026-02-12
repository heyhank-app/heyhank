import { ClawdLogo } from "./ClawdLogo";
import { InstallBlock } from "./InstallBlock";

export function Hero() {
  return (
    <section className="pt-14 sm:pt-20 pb-16 px-5 sm:px-7">
      <div className="max-w-[1060px] mx-auto">
        <div className="cc-label animate-fade-up-1 mb-5 text-center">The Companion</div>
        <div className="animate-fade-up-2 mb-7 inline-flex w-full justify-center">
          <div className="cc-card rounded-2xl p-2 bg-cc-card">
            <div className="bg-[#efe3cd] rounded-xl px-4 py-2.5">
              <ClawdLogo size={72} />
            </div>
          </div>
        </div>

        <h1 className="font-condensed text-center text-[clamp(54px,13vw,126px)] uppercase tracking-tight leading-[0.86] mb-6 animate-sweep">
          Code Faster
          <br />
          <span className="text-cc-primary">In Browser</span>
        </h1>

        <p className="text-center text-[clamp(16px,2.5vw,20px)] text-cc-muted max-w-[680px] mx-auto mb-10 leading-relaxed animate-fade-up-3">
          A browser control room for Claude Code and Codex with real-time agent output, full tool-call transparency,
          and safe multi-session orchestration.
        </p>

        <div className="animate-fade-up-4 text-center">
          <InstallBlock />
        </div>

        <p className="mt-4 text-center text-sm text-cc-muted animate-fade-up-4">
          Then open{" "}
          <code className="font-mono-code text-[13px] bg-cc-card border border-cc-border px-1.5 py-0.5 rounded">
            localhost:3456
          </code>
        </p>

        <div className="mt-8 mx-auto max-w-[760px] cc-card bg-cc-card rounded-2xl p-5 sm:p-6 animate-fade-up-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            {[
              ["Live Streams", "Token-level responses and tool events rendered as they happen."],
              ["Session Matrix", "Run parallel tasks with separate contexts, models, and permissions."],
              ["Audit Trail", "Inspect every command and file operation without leaving the thread."],
            ].map(([title, body]) => (
              <div key={title}>
                <h3 className="font-condensed text-xl uppercase tracking-wide">{title}</h3>
                <p className="text-sm text-cc-muted leading-relaxed mt-1.5">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

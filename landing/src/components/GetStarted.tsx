import { FadeIn } from "./FadeIn";
import { InstallBlock } from "./InstallBlock";

export function GetStarted() {
  return (
    <section className="py-24 px-6 text-center">
      <div className="max-w-[960px] mx-auto">
        <div className="w-12 h-0.5 bg-cc-border rounded-full mx-auto mb-12" />

        <h2 className="font-serif-display text-[clamp(24px,4vw,32px)] font-bold mb-12 tracking-tight">
          Get started
        </h2>

        <FadeIn>
          <InstallBlock large />
        </FadeIn>

        <FadeIn className="mt-6">
          <div className="flex justify-center gap-6 flex-wrap text-sm text-cc-muted">
            {["Bun runtime", "Claude Code CLI", "Active subscription"].map((req) => (
              <span key={req} className="flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#5BA8A0" strokeWidth="1.5">
                  <polyline points="13 4 6 11 3 8" />
                </svg>
                {req}
              </span>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

import { FadeIn } from "./FadeIn";

export function Screenshot() {
  return (
    <div className="pb-24 px-6">
      <div className="max-w-[960px] mx-auto">
        <FadeIn>
          <div className="bg-cc-card rounded-2xl shadow-lg overflow-hidden border border-cc-border">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-cc-border">
              <div className="w-2.5 h-2.5 rounded-full bg-cc-border" />
              <div className="w-2.5 h-2.5 rounded-full bg-cc-border" />
              <div className="w-2.5 h-2.5 rounded-full bg-cc-border" />
            </div>
            <img
              src="/screenshot.png"
              alt="The Companion UI — multiple sessions with streaming and tool call visibility"
              className="w-full block"
              loading="lazy"
            />
          </div>
        </FadeIn>
      </div>
    </div>
  );
}

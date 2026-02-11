import { ClawdLogo } from "./ClawdLogo";

export function Nav() {
  return (
    <nav className="sticky top-0 z-50 bg-cc-bg/85 backdrop-blur-xl border-b border-cc-border h-14 flex items-center px-6">
      <div className="max-w-[960px] mx-auto w-full flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5 font-semibold text-[15px] text-cc-fg no-underline">
          <ClawdLogo size={28} />
          The Companion
        </a>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/The-Vibe-Company/companion"
            target="_blank"
            rel="noopener"
            className="text-sm text-cc-muted hover:text-cc-fg transition-colors hidden sm:block"
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/the-vibe-companion"
            target="_blank"
            rel="noopener"
            className="text-sm text-cc-muted hover:text-cc-fg transition-colors hidden sm:block"
          >
            npm
          </a>
          <a
            href="https://github.com/The-Vibe-Company/companion"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-cc-primary text-white rounded-lg text-[13px] font-medium font-mono-code hover:bg-cc-primary-hover transition-all hover:-translate-y-px"
          >
            Get Started
          </a>
        </div>
      </div>
    </nav>
  );
}

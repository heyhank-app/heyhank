export function Footer() {
  return (
    <footer className="border-t border-cc-border py-8 px-6 text-center text-sm text-cc-muted">
      <p>Built by The Vibe Company</p>
      <div className="flex justify-center gap-6 mt-2">
        <a href="https://github.com/The-Vibe-Company/companion" target="_blank" rel="noopener" className="text-cc-muted hover:text-cc-fg transition-colors">
          GitHub
        </a>
        <a href="https://www.npmjs.com/package/the-vibe-companion" target="_blank" rel="noopener" className="text-cc-muted hover:text-cc-fg transition-colors">
          npm
        </a>
        <a href="https://github.com/The-Vibe-Company/companion/blob/main/LICENSE" target="_blank" rel="noopener" className="text-cc-muted hover:text-cc-fg transition-colors">
          MIT License
        </a>
      </div>
    </footer>
  );
}

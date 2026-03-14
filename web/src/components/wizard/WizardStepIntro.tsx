import { useStore } from "../../store.js";

interface WizardStepIntroProps {
  onNext: () => void;
}

export function WizardStepIntro({ onNext }: WizardStepIntroProps) {
  const publicUrl = useStore((s) => s.publicUrl);
  const baseUrl = publicUrl || window.location.origin;

  const hasPublicUrl = !!publicUrl;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-cc-fg">Set up the Linear Agent</h2>
        <p className="mt-1 text-sm text-cc-muted">
          This wizard will guide you through connecting Linear's Agent Interaction SDK and creating an agent
          that responds to @mentions in your Linear workspace.
        </p>
      </div>

      {/* Prerequisites */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-cc-fg">Prerequisites</h3>

        <div className={`flex items-start gap-3 p-3 rounded-lg border ${hasPublicUrl ? "border-cc-success/30 bg-cc-success/5" : "border-cc-warning/30 bg-cc-warning/5"}`}>
          <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${hasPublicUrl ? "bg-cc-success/20 text-cc-success" : "bg-cc-warning/20 text-cc-warning"}`}>
            {hasPublicUrl ? (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <span className="text-xs font-bold">!</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-cc-fg font-medium">Public URL configured</p>
            <p className="text-xs text-cc-muted mt-0.5">
              {hasPublicUrl
                ? <>Your public URL is <code className="px-1 py-0.5 rounded bg-cc-hover text-[10px]">{publicUrl}</code></>
                : <>No public URL set. Linear needs to reach your Companion instance. Configure one in <a href="#/integrations/tailscale" className="text-cc-primary underline">Tailscale settings</a> or <a href="#/settings" className="text-cc-primary underline">General settings</a>.</>
              }
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg border border-cc-border bg-cc-card">
          <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center bg-cc-hover text-cc-muted">
            <span className="text-xs font-bold">1</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-cc-fg font-medium">Create a Linear OAuth app</p>
            <p className="text-xs text-cc-muted mt-0.5">
              Go to{" "}
              <a href="https://linear.app/settings/api" target="_blank" rel="noopener noreferrer" className="text-cc-primary underline">
                Linear &rarr; Settings &rarr; API &rarr; OAuth Applications
              </a>{" "}
              and create a new app with the following settings:
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-cc-muted">
              <li>Enable <strong className="text-cc-fg">Webhooks</strong> and subscribe to <strong className="text-cc-fg">Agent session events</strong>.</li>
              <li>Add the scope <code className="px-1 py-0.5 rounded bg-cc-hover">app:mentionable</code>.</li>
              <li>
                Set the <strong className="text-cc-fg">Redirect URI</strong> to:{" "}
                <code className="px-1 py-0.5 rounded bg-cc-hover text-[10px] break-all">{`${baseUrl}/api/linear/oauth/callback`}</code>
              </li>
              <li>
                Set the <strong className="text-cc-fg">Webhook URL</strong> to:{" "}
                <code className="px-1 py-0.5 rounded bg-cc-hover text-[10px] break-all">{`${baseUrl}/api/linear/agent-webhook`}</code>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="px-4 py-2.5 rounded-lg text-sm font-medium bg-cc-primary hover:bg-cc-primary-hover text-white transition-colors cursor-pointer"
        >
          Next
        </button>
      </div>
    </div>
  );
}

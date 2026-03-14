interface WizardStepDoneProps {
  agentName: string;
  onFinish: () => void;
  onAddAnother?: () => void;
}

export function WizardStepDone({ agentName, onFinish, onAddAnother }: WizardStepDoneProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-cc-fg">Setup Complete</h2>
        <p className="mt-1 text-sm text-cc-muted">
          Your Linear Agent is ready to go.
        </p>
      </div>

      {/* Summary checklist */}
      <div className="space-y-3">
        {[
          { label: "OAuth app connected", detail: "Your Linear workspace is linked" },
          { label: `Agent "${agentName}" created`, detail: "With Linear trigger enabled and full auto permissions" },
          { label: "Ready for @mentions", detail: "Mention the agent in any Linear issue to trigger a session" },
        ].map((item) => (
          <div key={item.label} className="flex items-start gap-3 p-3 rounded-lg border border-cc-success/30 bg-cc-success/5">
            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-cc-success/20 flex items-center justify-center mt-0.5">
              <svg className="w-3 h-3 text-cc-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-cc-fg">{item.label}</p>
              <p className="text-xs text-cc-muted">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {/* What's next */}
      <div className="p-4 rounded-lg border border-cc-border bg-cc-card">
        <h3 className="text-sm font-medium text-cc-fg mb-2">What's next?</h3>
        <ul className="space-y-1.5 text-xs text-cc-muted">
          <li>Go to any issue in Linear and <strong className="text-cc-fg">@mention your agent</strong> to test it.</li>
          <li>
            Customize the agent further in the{" "}
            <a href="#/agents" className="text-cc-primary underline">Agents page</a>.
          </li>
          <li>
            Manage OAuth credentials in{" "}
            <a href="#/integrations/linear" className="text-cc-primary underline">Linear Settings</a>.
          </li>
        </ul>
      </div>

      <div className="flex justify-between">
        {onAddAnother && (
          <button
            onClick={onAddAnother}
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          >
            + Create Another Agent
          </button>
        )}
        <button
          onClick={onFinish}
          className="px-4 py-2.5 rounded-lg text-sm font-medium bg-cc-primary hover:bg-cc-primary-hover text-white transition-colors cursor-pointer ml-auto"
        >
          Go to Agents
        </button>
      </div>
    </div>
  );
}

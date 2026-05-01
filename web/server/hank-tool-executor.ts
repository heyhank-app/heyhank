// ─── Hank Tool Executor ─────────────────────────────────────────────────────
// Executes tool calls for all Hank-UI providers.
// Extracted from platform-routes.ts POST /gemini/tool-call.

import * as assistantStore from "./assistant-store.js";
import { readSkillContent, listInstalledSkills } from "./skill-discovery.js";
import * as emailService from "./email-service.js";
import * as calendarService from "./calendar-service.js";
import { listAgents, createAgent } from "./agent-store.js";
import { buildStyleProfileBlockFromText } from "./style-injector.js";

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 3100}/api`;

export async function executeHankTool(
  name: string,
  args: Record<string, unknown> | undefined,
  authHeader: string,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authHeader ? { Authorization: authHeader } : {}),
  };
  const base = BASE_URL;

  console.log(`[hank-tool] ${name}`, JSON.stringify(args || {}).slice(0, 200));

  try {
    switch (name) {
      // ─── Skill Invocation ─────────────────────────────────────────
      case "run_skill": {
        const slug = (args?.slug as string) || "";
        const input = (args?.input as string) || "";
        if (!slug) return { error: "slug is required" };
        const content = readSkillContent(slug);
        if (!content) {
          const available = listInstalledSkills().map((s) => s.slug).join(", ");
          return { error: `Skill "${slug}" not found. Installed: ${available}` };
        }
        // Return the full SKILL.md so the LLM can follow the workflow in the
        // current chat. Hank reads the skill's instructions and continues
        // the multi-stage dialog with the user — no agent dispatch needed.
        return {
          ok: true,
          slug,
          input: input || null,
          skill: content,
          instruction:
            "You are now executing a multi-stage skill workflow. The SKILL.md content above defines the stages.\n\n"
            + "PROCESS:\n"
            + "1. If the skill needs inputs and you don\'t have them all yet, ask the user (in ONE message, all required fields).\n"
            + "2. Once inputs are clear, IMMEDIATELY produce Stage 1\'s output exactly as the skill specifies (tables, lists, structure).\n"
            + "3. End each stage by briefly asking: \'Weiter zum nächsten Stage oder diesen überarbeiten?\'.\n"
            + "4. When the user replies with continuation (weiter / next / continue / fortfahren / mache weiter / ja / proceed / ok), IMMEDIATELY produce the NEXT stage\'s output following the skill\'s instructions. DO NOT ask clarifying questions. DO NOT call run_skill again. DO NOT echo the user back. Just produce the next stage.\n"
            + "5. Track which stage you are on by referring back to the skill\'s stage list (Stage 1, Stage 2, …). Mention the stage number in your output header.\n"
            + "6. Continue until all stages are complete or the user stops you.\n\n"
            + "CRITICAL: when the user signals continuation, your next message MUST start with the next stage\'s output. Do not ask 'kannst du fortfahren?' — that question is for the user to ask you, not the other way around.",
        };
      }

      // ─── Agent Orchestration ──────────────────────────────────────
      case "run_agent": {
        const agentQuery = (args?.agent as string) || "";
        let task = (args?.task as string) || "";
        if (!agentQuery || !task) {
          return { error: "agent and task are required" };
        }

        // Inject uploaded file context if provided
        const files = (args?.files as string[]) || (args?.attachments as string[]) || [];
        if (files.length > 0) {
          task = `The user has shared these files with you: ${files.join(", ")}. They are available on the local filesystem.\n\n${task}`;
        }

        // Auto-inject SocialView persona style profile if the task references
        // a known role-model by name/handle. The Content Agent treats this
        // block as binding (overrides platform defaults).
        try {
          const styleBlock = buildStyleProfileBlockFromText(task);
          if (styleBlock) {
            task = task + styleBlock;
            console.log(`[hank-tool] run_agent: injected style profile block (${styleBlock.length} chars)`);
          }
        } catch (e) {
          console.error(`[hank-tool] style-injector failed:`, e);
        }

        // Fuzzy match agent by name or ID
        const agents = listAgents();
        let matched = agents.find((a) => a.id === agentQuery || a.name.toLowerCase() === agentQuery.toLowerCase());
        if (!matched) {
          // Fuzzy: find best match by name similarity
          const q = agentQuery.toLowerCase();
          let bestScore = 0;
          for (const a of agents) {
            const name = a.name.toLowerCase();
            let score = 0;
            if (name.includes(q) || q.includes(name)) score = 0.8;
            else {
              // Word overlap
              const qWords = q.split(/\s+/);
              const nWords = name.split(/\s+/);
              const overlap = qWords.filter((w) => nWords.some((n) => n.includes(w) || w.includes(n))).length;
              score = overlap / Math.max(qWords.length, nWords.length);
            }
            if (score > bestScore) { bestScore = score; matched = a; }
          }
          if (bestScore < 0.3) matched = undefined;
        }

        if (!matched) {
          const available = agents.map((a) => `"${a.name}" (${a.id})`).join(", ");
          return { error: `Agent "${agentQuery}" not found. Available: ${available}` };
        }

        // Run the agent via /api/agents/:id/run
        const runRes = await fetch(`${base}/agents/${matched.id}/run`, {
          method: "POST",
          headers,
          body: JSON.stringify({ input: task }),
        });
        const runData = await runRes.json() as Record<string, unknown>;

        if (!runRes.ok) {
          return { error: `Failed to run agent: ${(runData as { error?: string }).error || "Unknown error"}` };
        }

        const sessionId = (runData as { sessionId?: string }).sessionId || null;

        // Wait for agent to finish by watching message history growth.
        // Agent sessions: CLI connects → user_message sent → agent streams response → result.
        // We poll until we see a "result" message (= agent turn finished).
        if (sessionId) {
          const pollStart = Date.now();
          const POLL_TIMEOUT = 300_000; // 5min max for agents that generate images/content
          const POLL_INTERVAL = 2_000; // check every 2s

          // Small initial delay for CLI to connect
          await new Promise(r => setTimeout(r, 2_000));

          while (Date.now() - pollStart < POLL_TIMEOUT) {
            try {
              const statusRes = await fetch(`${base}/sessions/${sessionId}/agent-status`, { headers });
              if (statusRes.ok) {
                const status = await statusRes.json() as Record<string, unknown>;
                const activity = (status.recentActivity as Array<{ type: string; text?: string }>) || [];
                const phase = status.phase as string;
                const state = status.state as string;

                // Check if agent has produced a final result message (= conversation ended)
                const hasResult = activity.some(a => a.type === "result");
                // Agent is truly finished only when:
                // 1. Session terminated (CLI exited), OR
                // 2. There's a "result" message (final SDK result) and session is idle
                // NOTE: phase="ready" happens between EVERY tool call turn, not just at the end.
                // We must NOT treat "ready" + "hasAssistantOutput" as finished — the agent
                // may still have many more tool calls to make.
                const isTerminated = phase === "terminated";
                const isFinished = isTerminated || (phase === "ready" && hasResult);

                console.log(`[hank-tool] polling ${sessionId.slice(0, 8)}: phase=${phase} hasResult=${hasResult} elapsed=${Math.round((Date.now() - pollStart) / 1000)}s`);

                if (isFinished) {
                  const resultText = activity
                    .filter(a => a.text)
                    .map(a => a.text)
                    .join("\n");

                  return {
                    success: true,
                    agentName: matched.name,
                    agentId: matched.id,
                    sessionId,
                    status: "completed",
                    agentResult: resultText || "Agent finished the task.",
                    message: `Agent "${matched.name}" has finished. Check the session for full details.`,
                  };
                }

                // Agent needs permission
                if (status.needsInput) {
                  const perms = (status.pendingPermissions as Array<{ toolName: string; description: string }>) || [];
                  return {
                    success: true,
                    agentName: matched.name,
                    agentId: matched.id,
                    sessionId,
                    status: "needs_permission",
                    message: `Agent "${matched.name}" needs permission: ${perms.map(p => p.toolName).join(", ")}. Check the session to approve.`,
                  };
                }

                // Agent exited
                if (state === "exited") {
                  return {
                    success: false,
                    agentName: matched.name,
                    sessionId,
                    status: "exited",
                    message: `Agent "${matched.name}" exited unexpectedly. Check the session for details.`,
                  };
                }
              }
            } catch {
              // Polling error — continue trying
            }
            await new Promise(r => setTimeout(r, POLL_INTERVAL));
          }

          // Timeout — return what we have
          return {
            success: true,
            agentName: matched.name,
            agentId: matched.id,
            sessionId,
            status: "still_running",
            message: `Agent "${matched.name}" is still working. Check the session for progress.`,
          };
        }

        return {
          success: true,
          agentName: matched.name,
          agentId: matched.id,
          sessionId,
          model: matched.model,
          message: `Agent "${matched.name}" started.`,
        };
      }

      case "create_agent": {
        const agentName = (args?.name as string) || "";
        const agentPrompt = (args?.prompt as string) || "";
        const agentDesc = (args?.description as string) || "";
        const agentModel = (args?.model as string) || "claude-sonnet-4-20250514";
        const agentCwd = (args?.cwd as string) || "";
        const autoStart = args?.autoStart as boolean;
        const autoTask = (args?.task as string) || "";

        if (!agentName || !agentPrompt) {
          return { error: "name and prompt are required" };
        }

        try {
          const newAgent = createAgent({
            name: agentName,
            description: agentDesc,
            prompt: agentPrompt,
            backendType: "claude",
            model: agentModel,
            permissionMode: "auto-accept",
            cwd: agentCwd,
            version: 1,
            enabled: true,
          });

          let sessionId: string | null = null;
          if (autoStart && autoTask) {
            const runRes = await fetch(`${base}/agents/${newAgent.id}/run`, {
              method: "POST",
              headers,
              body: JSON.stringify({ input: autoTask }),
            });
            if (runRes.ok) {
              const runData = await runRes.json() as { sessionId?: string };
              sessionId = runData.sessionId || null;
            }
          }

          return {
            success: true,
            agentName: newAgent.name,
            agentId: newAgent.id,
            ...(sessionId ? { sessionId, message: `Agent "${newAgent.name}" created and started. Session ID: ${sessionId}. Use monitor_agent_session to check progress.` } : { message: `Agent "${newAgent.name}" created successfully. Use run_agent to start it.` }),
          };
        } catch (err) {
          return { error: `Failed to create agent: ${err instanceof Error ? err.message : "Unknown error"}` };
        }
      }

      case "list_sessions": {
        const res = await fetch(`${base}/sessions`, { headers });
        const sessions = await res.json() as Array<Record<string, unknown>>;
        // Return a compact summary
        const summary = sessions
          .filter((s) => s.state !== "exited" && !s.archived)
          .map((s) => ({
            id: s.sessionId,
            state: s.state,
            model: s.model || "unknown",
            backend: s.backendType || "claude",
            cwd: s.cwd,
            name: s.name || null,
          }));
        return { sessions: summary, count: summary.length };
      }

      case "create_session": {
        const backend = (args?.backend as string) || "claude";
        const cwd = (args?.cwd as string) || "/opt/agentplatform/web";
        const message = args?.message as string | undefined;

        const res = await fetch(`${base}/sessions/create`, {
          method: "POST",
          headers,
          body: JSON.stringify({ backend, cwd }),
        });
        const session = await res.json() as Record<string, unknown>;

        if (!res.ok) {
          const errMsg = typeof (session as { error?: string }).error === "string" ? (session as { error?: string }).error : "Unknown error";
          return { error: `Failed to create session: ${errMsg}` };
        }

        const result: Record<string, unknown> = {
          sessionId: session.sessionId,
          state: session.state,
          cwd: session.cwd,
          message: `Session created successfully with ${backend}.`,
        };

        // If there's an initial message, send it via WebSocket bridge endpoint
        if (message && session.sessionId) {
          result.initialMessage = message;
          result.note = "Initial message will be sent once the session is connected. The user should see it in the chat.";
          // Fire and forget — don't block the tool response to Gemini
          fetch(`${base}/gemini/send-to-session`, {
            method: "POST",
            headers,
            body: JSON.stringify({ sessionId: session.sessionId, message }),
          }).catch(() => {});
        }

        return result;
      }

      case "send_message": {
        const sessionId = args?.session_id as string;
        const message = args?.message as string;

        if (!sessionId || !message) {
          return { error: "session_id and message are required" };
        }

        // Use the internal send endpoint
        const res = await fetch(`${base}/gemini/send-to-session`, {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionId, message }),
        });
        const data = await res.json() as Record<string, unknown>;

        if (!res.ok) {
          const errMsg = typeof (data as { error?: string }).error === "string" ? (data as { error?: string }).error : "Unknown error";
          return { error: `Failed to send message: ${errMsg}` };
        }

        return { success: true, sessionId, message: "Message sent to session." };
      }

      case "get_session_status":
      case "monitor_agent_session": {
        const sessionId = args?.session_id as string;
        if (!sessionId) {
          return { error: "session_id is required" };
        }

        const res = await fetch(`${base}/sessions/${sessionId}/agent-status`, { headers });
        if (!res.ok) {
          return { error: "Session not found" };
        }
        const status = await res.json() as Record<string, unknown>;

        // Build a human-readable summary for Gemini
        let summary = "";
        if (status.needsInput) {
          const perms = status.pendingPermissions as Array<{ toolName: string; description: string }>;
          summary = `ATTENTION: Agent needs permission! Pending: ${perms.map((p) => `${p.toolName}${p.description ? ` (${p.description})` : ""}`).join(", ")}. Tell the user immediately!`;
        } else if (status.isCompleted) {
          summary = "Agent has finished. Task is complete.";
        } else if (status.isWorking) {
          summary = "Agent is still working...";
        } else {
          summary = `Agent phase: ${status.phase}`;
        }

        return {
          ...status,
          summary,
        };
      }

      // ─── Todo Tools ───────────────────────────────────────────────
      case "list_todos": {
        const todos = assistantStore.listTodos({
          done: args?.show_completed ? undefined : false,
          priority: args?.priority as string | undefined,
          category: args?.category as string | undefined,
        });
        return { todos, count: todos.length };
      }

      case "add_todo": {
        const text = args?.text as string;
        if (!text) return { error: "text is required" };
        const todo = assistantStore.addTodo(text, args?.priority as string, args?.category as string | undefined);
        return { todo, message: "Todo added." };
      }

      case "complete_todo": {
        const id = args?.id as string;
        if (!id) return { error: "id is required" };
        const todo = assistantStore.completeTodo(id);
        return todo ? { todo, message: "Todo completed." } : { error: "Todo not found" };
      }

      case "delete_todo": {
        const id = args?.id as string;
        if (!id) return { error: "id is required" };
        const ok = assistantStore.deleteTodo(id);
        return ok ? { message: "Todo deleted." } : { error: "Todo not found" };
      }

      case "update_todo": {
        const id = args?.id as string;
        if (!id) return { error: "id is required" };
        const todo = assistantStore.updateTodo(id, {
          text: args?.text as string | undefined,
          priority: args?.priority as string | undefined,
          category: args?.category as string | undefined,
          delegatedTo: args?.delegatedTo as string | undefined,
          dueDate: args?.dueDate as string | undefined,
          followUpDate: args?.followUpDate as string | undefined,
          project: args?.project as string | undefined,
        });
        return todo ? { todo, message: "Todo updated." } : { error: "Todo not found" };
      }

      case "delegate_task": {
        const text = args?.text as string;
        const delegatedTo = args?.delegatedTo as string;
        if (!text || !delegatedTo) return { error: "text and delegatedTo are required" };
        const todo = assistantStore.addTodo(text, (args?.priority as string) || "medium", args?.category as string | undefined, {
          delegatedTo,
          dueDate: args?.dueDate as string | undefined,
          project: args?.project as string | undefined,
        });
        return { todo, message: `Task delegated to ${delegatedTo}.` };
      }

      case "list_delegations": {
        const delegations = assistantStore.listDelegations(args?.person as string | undefined);
        const grouped: Record<string, typeof delegations> = {};
        for (const d of delegations) {
          const key = d.delegatedTo || "unknown";
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(d);
        }
        return { delegations: grouped, count: delegations.length };
      }

      case "list_projects": {
        const allTodos = assistantStore.listTodos();
        const projects: Record<string, { project: string; total: number; done: number; open: number }> = {};
        for (const t of allTodos) {
          if (!t.project) continue;
          if (!projects[t.project]) projects[t.project] = { project: t.project, total: 0, done: 0, open: 0 };
          projects[t.project].total++;
          if (t.done) projects[t.project].done++;
          else projects[t.project].open++;
        }
        return { projects: Object.values(projects), count: Object.keys(projects).length };
      }

      case "create_project": {
        const projectName = args?.name as string;
        if (!projectName) return { error: "name is required" };
        const note = assistantStore.addNote(projectName, (args?.description as string) || "", ["project"]);
        const todos: ReturnType<typeof assistantStore.addTodo>[] = [];
        const todoTexts = (args?.todos as string[]) || [];
        for (const text of todoTexts) {
          todos.push(assistantStore.addTodo(text, "medium", undefined, { project: projectName }));
        }
        return { note, todos, message: `Project "${projectName}" created with ${todos.length} todo(s).` };
      }

      // ─── Note Tools ──────────────────────────────────────────────
      case "search_notes": {
        const notes = assistantStore.listNotes(args?.query as string | undefined);
        return { notes, count: notes.length };
      }

      case "add_note": {
        const title = args?.title as string;
        const content = args?.content as string || "";
        if (!title) return { error: "title is required" };
        const tags = args?.tags ? (args.tags as string).split(",").map((t: string) => t.trim()) : [];
        const note = assistantStore.addNote(title, content, tags);
        return { note, message: "Note saved." };
      }

      case "update_note": {
        const id = args?.id as string;
        if (!id) return { error: "id is required" };
        const tags = args?.tags ? (args.tags as string).split(",").map((t: string) => t.trim()) : undefined;
        const note = assistantStore.updateNote(id, {
          title: args?.title as string | undefined,
          content: args?.content as string | undefined,
          tags,
        });
        return note ? { note, message: "Note updated." } : { error: "Note not found" };
      }

      case "delete_note": {
        const id = args?.id as string;
        if (!id) return { error: "id is required" };
        const ok = assistantStore.deleteNote(id);
        return ok ? { message: "Note deleted." } : { error: "Note not found" };
      }

      // ─── Reminder Tools ──────────────────────────────────────────
      case "list_reminders": {
        const reminders = assistantStore.listReminders(!!args?.include_fired);
        return { reminders, count: reminders.length };
      }

      case "add_reminder": {
        const text = args?.text as string;
        const triggerAt = args?.trigger_at as string;
        if (!text || !triggerAt) return { error: "text and trigger_at are required" };
        const reminder = assistantStore.addReminder(text, triggerAt);
        return { reminder, message: "Reminder set." };
      }

      case "delete_reminder": {
        const id = args?.id as string;
        if (!id) return { error: "id is required" };
        const ok = assistantStore.deleteReminder(id);
        return ok ? { message: "Reminder deleted." } : { error: "Reminder not found" };
      }

      // ─── Email Tools ─────────────────────────────────────────────
      case "list_email_accounts": {
        const accounts = emailService.loadAccounts();
        return { accounts: accounts.map((a) => ({ id: a.id, name: a.name, email: a.email })), count: accounts.length };
      }

      case "list_emails": {
        const accountId = args?.account as string;
        if (!accountId) return { error: "account (name, email or id) is required" };
        const account = emailService.getAccount(accountId);
        if (!account) return { error: `Account "${accountId}" not found. Use list_email_accounts to see available accounts.` };
        const emails = await emailService.listEmails(account, {
          limit: (args?.limit as number) || 10,
          unseen: !!args?.unseen_only,
        });
        return { emails, count: emails.length, account: account.name };
      }

      case "read_email": {
        const accountId = args?.account as string;
        const uid = args?.uid as number;
        if (!accountId || !uid) return { error: "account and uid are required" };
        const account = emailService.getAccount(accountId);
        if (!account) return { error: `Account "${accountId}" not found` };
        const email = await emailService.readEmail(account, uid);
        if (!email) return { error: "Email not found" };
        // Clean up body for voice readability: strip encoding artifacts, excessive whitespace
        let body = email.textBody || "(empty)";
        // Remove common MIME/encoding artifacts
        body = body.replace(/=\r?\n/g, "");
        body = body.replace(/=([0-9A-Fa-f]{2})/g, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        body = body.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
        body = body.replace(/\s+/g, " ").trim();
        // Limit for Gemini tool response (keep it voice-friendly)
        if (body.length > 1500) body = body.slice(0, 1500) + "...";
        return { subject: email.subject, from: email.from, to: email.to, date: email.date, body };
      }

      case "search_emails": {
        const accountId = args?.account as string;
        const query = args?.query as string;
        if (!accountId || !query) return { error: "account and query are required" };
        const account = emailService.getAccount(accountId);
        if (!account) return { error: `Account "${accountId}" not found` };
        const emails = await emailService.searchEmails(account, query, (args?.limit as number) || 10);
        return { emails, count: emails.length };
      }

      case "send_email": {
        const accountId = args?.account as string;
        const to = args?.to as string;
        const subject = args?.subject as string;
        const body = args?.body as string;
        if (!accountId || !to || !subject || !body) return { error: "account, to, subject, and body are required" };
        const account = emailService.getAccount(accountId);
        if (!account) return { error: `Account "${accountId}" not found` };
        const result = await emailService.sendEmail(account, to, subject, body);
        return { ...result, message: `Email sent from ${account.email} to ${to}` };
      }

      case "reply_email": {
        const accountId = args?.account as string;
        const uid = args?.uid as number;
        const body = args?.body as string;
        if (!accountId || !uid || !body) return { error: "account, uid, and body are required" };
        const account = emailService.getAccount(accountId);
        if (!account) return { error: `Account "${accountId}" not found` };
        const result = await emailService.replyToEmail(account, uid, body);
        return { ...result, message: "Reply sent." };
      }

      case "email_summary": {
        const summary = await emailService.getUnreadSummary();
        return { accounts: summary, totalUnread: summary.reduce((s, a) => s + a.unread, 0) };
      }

      // ─── Calendar Tools ────────────────────────────────────────────
      case "list_calendar_accounts": {
        const accounts = calendarService.loadAccounts();
        return { accounts: accounts.map((a) => ({ id: a.id, name: a.name, provider: a.provider })), count: accounts.length };
      }

      case "list_events": {
        const accountId = args?.account as string;
        if (!accountId) return { error: "account (name or id) is required" };
        const calAccount = calendarService.getAccount(accountId);
        if (!calAccount) return { error: `Calendar account "${accountId}" not found. Use list_calendar_accounts to see available accounts.` };
        const events = await calendarService.listEvents(calAccount, {
          from: args?.from as string | undefined,
          to: args?.to as string | undefined,
        });
        return { events, count: events.length, account: calAccount.name };
      }

      case "create_event": {
        const accountId = args?.account as string;
        const summary = args?.summary as string;
        const start = args?.start as string;
        const end = args?.end as string;
        if (!accountId || !summary || !start || !end) {
          return { error: "account, summary, start, and end are required" };
        }
        const calAccount = calendarService.getAccount(accountId);
        if (!calAccount) return { error: `Calendar account "${accountId}" not found` };
        const created = await calendarService.createEvent(calAccount, {
          summary,
          description: args?.description as string | undefined,
          location: args?.location as string | undefined,
          start,
          end,
          allDay: !!args?.all_day,
        });
        return { ...created, message: `Event "${summary}" created.` };
      }

      case "search_events": {
        const accountId = args?.account as string;
        const query = args?.query as string;
        if (!accountId || !query) return { error: "account and query are required" };
        const calAccount = calendarService.getAccount(accountId);
        if (!calAccount) return { error: `Calendar account "${accountId}" not found` };
        const events = await calendarService.searchEvents(calAccount, query, {
          from: args?.from as string | undefined,
          to: args?.to as string | undefined,
        });
        return { events, count: events.length };
      }

      case "delete_event": {
        const accountId = args?.account as string;
        const uid = args?.uid as string;
        if (!accountId || !uid) return { error: "account and uid are required" };
        const calAccount = calendarService.getAccount(accountId);
        if (!calAccount) return { error: `Calendar account "${accountId}" not found` };
        const deleted = await calendarService.deleteEvent(calAccount, uid);
        return deleted ? { message: "Event deleted." } : { error: "Event not found" };
      }

      case "calendar_summary": {
        const summary = await calendarService.getUpcomingSummary();
        return { accounts: summary };
      }

      // ─── Telephony ──────────────────────────────────────────────────
      case "make_call": {
        const contactNameOrPhone = (args?.phone as string) || "";
        const task = (args?.task as string) || "";
        const listen = args?.listen === true;
        const useSavedScript = args?.useSavedScript === true;
        if (!contactNameOrPhone || !task) {
          return { error: "phone (contact name) and task are required" };
        }
        try {
          // Contacts-only: resolve by name. Raw phone numbers are not allowed.
          const { resolveContactByName } = await import("./telephony/telephony-store.js");
          const contact = resolveContactByName(contactNameOrPhone);
          if (!contact) {
            return { error: `Contact "${contactNameOrPhone}" not found. For safety, only saved contacts can be called. Add the contact in Settings → Telephony → Contacts first.` };
          }
          const { callManager } = await import("./telephony/call-manager.js");
          const call = await callManager.startCall({ phone: contact.phone, prompt: task, voice: args?.voice as string, listen, useSavedScript });
          return {
            success: true,
            callId: call.id,
            contactName: contact.name,
            phone: call.phone,
            status: call.status,
            listenMode: call.listenMode,
            message: `Call to ${contact.name} (${call.phone}) initiated. Status: ${call.status}. Call ID: ${call.id}${listen ? " — Listen mode active." : ""}`,
          };
        } catch (err) {
          return { error: `Failed to start call: ${err instanceof Error ? err.message : "Unknown error"}` };
        }
      }

      case "list_active_calls": {
        try {
          const { callManager } = await import("./telephony/call-manager.js");
          const calls = callManager.getActiveCalls();
          return {
            calls: calls.map((c) => ({
              callId: c.id,
              phone: c.phone,
              status: c.status,
              durationSeconds: c.connectedAt ? Math.round((Date.now() - c.connectedAt) / 1000) : 0,
              prompt: c.prompt,
            })),
            message: calls.length > 0
              ? `${calls.length} active call(s): ${calls.map((c) => `${c.phone} (${c.status})`).join(", ")}`
              : "No active calls.",
          };
        } catch {
          return { calls: [], message: "No active calls." };
        }
      }

      case "end_active_call": {
        const callId = (args?.call_id as string) || "";
        if (!callId) return { error: "call_id is required" };
        try {
          const { callManager } = await import("./telephony/call-manager.js");
          const result = await callManager.endCall(callId);
          if (!result) return { error: "Call not found or already ended" };
          return {
            success: true,
            summary: result.summary,
            durationSeconds: result.durationSeconds,
            message: `Call ended. Duration: ${result.durationSeconds}s. ${result.summary || ""}`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to end call" };
        }
      }

      // ─── Social Media ──────────────────────────────────────────────
      case "prepare_social_post": {
        const postText = (args?.text as string) || "";
        const postPlatforms = (args?.platforms as string[]) || [];
        if (!postText) return { error: "text is required" };
        if (!postPlatforms.length) return { error: "platforms array is required" };
        try {
          const smManager = await import("./socialmedia/manager.js");
          const post = await smManager.createDraft({
            text: postText,
            platforms: postPlatforms as import("./socialmedia/types.js").SocialPlatform[],
            scheduledAt: (args?.scheduledAt as string) || null,
            mediaUrls: (args?.mediaUrls as string[]) || [],
            title: (args?.title as string) || undefined,
            firstComment: (args?.firstComment as string) || undefined,
            videoUrl: (args?.videoUrl as string) || undefined,
            thumbnailUrl: (args?.thumbnailUrl as string) || undefined,
            createdBy: "gemini",
          });
          return {
            success: true,
            postId: post.id,
            status: "draft",
            platforms: post.platforms,
            message: `Draft post prepared for ${postPlatforms.join(", ")}. The user can review and publish it from the Social Media page.`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to prepare post" };
        }
      }

      case "create_social_post": {
        const postText = (args?.text as string) || "";
        const postPlatforms = (args?.platforms as string[]) || [];
        if (!postText) return { error: "text is required" };
        if (!postPlatforms.length) return { error: "platforms array is required" };
        try {
          const smManager = await import("./socialmedia/manager.js");
          const post = await smManager.createPost({
            text: postText,
            platforms: postPlatforms as import("./socialmedia/types.js").SocialPlatform[],
            scheduledAt: (args?.scheduledAt as string) || null,
            mediaUrls: [],
          });
          return {
            success: true,
            postId: post.id,
            status: post.status,
            platforms: post.platforms,
            message: `Post created on ${postPlatforms.join(", ")}. Status: ${post.status}.`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to create post" };
        }
      }

      case "list_social_posts": {
        try {
          const smManager = await import("./socialmedia/manager.js");
          const posts = await smManager.listPosts({
            limit: (args?.limit as number) || 10,
            status: (args?.status as string) || undefined,
          });
          return {
            posts: posts.map((p) => ({
              id: p.id,
              text: p.text.slice(0, 100),
              status: p.status,
              platforms: p.platforms,
              createdAt: p.createdAt,
            })),
            message: posts.length > 0
              ? `${posts.length} post(s) found.`
              : "No posts found.",
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to list posts" };
        }
      }

      case "get_social_analytics": {
        const profileId = (args?.profileId as string) || "";
        if (!profileId) return { error: "profileId is required" };
        try {
          const smManager = await import("./socialmedia/manager.js");
          const analytics = await smManager.getAccountAnalytics(profileId);
          return { ...analytics, message: `Followers: ${analytics.followers}, Following: ${analytics.following}, Posts: ${analytics.posts}` };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to get analytics" };
        }
      }

      case "reply_to_social_comment": {
        const smPostId = (args?.postId as string) || "";
        const smCommentId = (args?.commentId as string) || null;
        const smText = (args?.text as string) || "";
        if (!smPostId || !smText) return { error: "postId and text are required" };
        try {
          const smManager = await import("./socialmedia/manager.js");
          const result = await smManager.replyToComment(smPostId, smCommentId, smText);
          return { ...result, message: result.ok ? "Reply sent." : `Failed: ${result.error}` };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to reply" };
        }
      }

      case "publish_draft": {
          const postId = (args?.postId as string) || "";
          if (!postId) return { error: "postId is required" };
          try {
            // Check if approval is required
            const smStore = await import("./socialmedia/store.js");
            const smSettings = smStore.getSettings();
            if (smSettings.requireApproval) {
              return {
                success: false,
                postId,
                status: "awaiting_approval",
                message: "Post requires manual approval. Please review and publish from the Social Media page.",
              };
            }
            const smManager = await import("./socialmedia/manager.js");
            const post = await smManager.publishDraft(postId);
            return { success: true, postId: post.id, status: post.status, message: `Draft published on ${post.platforms.join(", ")}.` };
          } catch (err) {
            return { error: err instanceof Error ? err.message : "Failed to publish draft" };
          }
        }

        case "update_draft": {
          const postId = (args?.postId as string) || "";
          if (!postId) return { error: "postId is required" };
          try {
            const smManager = await import("./socialmedia/manager.js");
            const post = await smManager.updateDraft(postId, {
              text: args?.text as string | undefined,
              platforms: args?.platforms as string[] | undefined,
              scheduledAt: args?.scheduledAt as string | undefined,
            });
            return { success: true, postId: post.id, message: "Draft updated." };
          } catch (err) {
            return { error: err instanceof Error ? err.message : "Failed to update draft" };
          }
        }

        case "delete_draft": {
          const postId = (args?.postId as string) || "";
          if (!postId) return { error: "postId is required" };
          try {
            const smManager = await import("./socialmedia/manager.js");
            const ok = await smManager.deleteDraft(postId);
            return ok ? { message: "Draft deleted." } : { error: "Draft not found" };
          } catch (err) {
            return { error: err instanceof Error ? err.message : "Failed to delete draft" };
          }
        }

        case "schedule_post": {
          const postId = (args?.postId as string) || "";
          const scheduledAt = (args?.scheduledAt as string) || "";
          if (!postId || !scheduledAt) return { error: "postId and scheduledAt are required" };
          try {
            const smManager = await import("./socialmedia/manager.js");
            const post = await smManager.updateDraft(postId, { scheduledAt });
            return { success: true, postId: post.id, scheduledAt, message: `Post scheduled for ${scheduledAt}.` };
          } catch (err) {
            return { error: err instanceof Error ? err.message : "Failed to schedule post" };
          }
        }

      case "fix_claude_auth": {
        const { attemptRefresh, getAuthStatus } = await import("./claude-auth-monitor.js");
        const success = await attemptRefresh();
        const status = getAuthStatus();
        return {
          success,
          status: status.status,
          message: success
            ? "Authentication refreshed successfully. Sessions should work now."
            : `Authentication refresh failed (status: ${status.status}). The user may need to run 'claude /login' in the terminal.`,
        };
      }

      // ─── Memory Tools ────────────────────────────────────────────────
        case "save_memory": {
          const content = (args?.content as string) || "";
          if (!content) return { error: "content is required" };
          const memService = await import("./memory-service.js");
          const memory = await memService.addMemory(content);
          return { memory, message: `Remembered: "${content}"` };
        }

        case "search_memory": {
          const query = (args?.query as string) || "";
          if (!query) return { error: "query is required" };
          const memService = await import("./memory-service.js");
          const memories = await memService.searchMemories(query);
          return { memories, count: memories.length };
        }

        case "list_memories": {
          const memService = await import("./memory-service.js");
          const memories = await memService.listMemories();
          return { memories, count: memories.length };
        }

        case "delete_memory": {
          const id = (args?.id as string) || "";
          if (!id) return { error: "id is required" };
          const memService = await import("./memory-service.js");
          const ok = await memService.deleteMemory(id);
          return ok ? { message: "Memory deleted." } : { error: "Memory not found" };
        }

      // ─── Contact Tools ────────────────────────────────────────────────
        case "list_contacts": {
          const contacts = assistantStore.listContacts(args?.search as string | undefined);
          return { contacts, count: contacts.length };
        }

        case "add_contact": {
          const name = (args?.name as string) || "";
          if (!name) return { error: "name is required" };
          const tags = args?.tags ? (args.tags as string).split(",").map((t: string) => t.trim()) : [];
          const contact = assistantStore.addContact(
            name,
            args?.company as string | undefined,
            args?.email as string | undefined,
            args?.phone as string | undefined,
            args?.notes as string | undefined,
            tags,
          );
          return { contact, message: "Contact added." };
        }

        case "update_contact": {
          const id = (args?.id as string) || "";
          if (!id) return { error: "id is required" };
          const tags = args?.tags ? (args.tags as string).split(",").map((t: string) => t.trim()) : undefined;
          const contact = assistantStore.updateContact(id, {
            name: args?.name as string | undefined,
            company: args?.company as string | undefined,
            email: args?.email as string | undefined,
            phone: args?.phone as string | undefined,
            notes: args?.notes as string | undefined,
            tags,
          });
          return contact ? { contact, message: "Contact updated." } : { error: "Contact not found" };
        }

        case "search_contacts": {
          const query = (args?.query as string) || "";
          if (!query) return { error: "query is required" };
          const contacts = assistantStore.listContacts(query);
          return { contacts, count: contacts.length };
        }

        case "log_interaction": {
          const contactId = (args?.contactId as string) || "";
          const type = (args?.type as string) || "";
          const summary = (args?.summary as string) || "";
          if (!contactId || !type || !summary) return { error: "contactId, type and summary are required" };
          const contact = assistantStore.logInteraction(contactId, {
            type: type as "call" | "email" | "meeting" | "note",
            summary,
          });
          return contact ? { contact, message: "Interaction logged." } : { error: "Contact not found" };
        }

      // ─── Decision Tools ───────────────────────────────────────────────
        case "log_decision": {
          const title = (args?.title as string) || "";
          const context = (args?.context as string) || "";
          const decision = (args?.decision as string) || "";
          if (!title || !context || !decision) return { error: "title, context and decision are required" };
          const alternatives = args?.alternatives ? (args.alternatives as string).split(",").map((a: string) => a.trim()) : [];
          const reasoning = (args?.reasoning as string) || "";
          const entry = assistantStore.addDecision(title, context, decision, alternatives, reasoning);
          return { decision: entry, message: "Decision logged." };
        }

        case "search_decisions": {
          const query = (args?.query as string) || "";
          if (!query) return { error: "query is required" };
          const decisions = assistantStore.listDecisions(query);
          return { decisions, count: decisions.length };
        }

      // ─── Daily Briefing ──────────────────────────────────────────────
      case "get_daily_briefing": {
        const dateStr = (args?.date as string) || new Date().toISOString().slice(0, 10);
        const today = dateStr;
        const tomorrowDate = new Date(dateStr);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrow = tomorrowDate.toISOString().slice(0, 10);

        const emailSummary = await emailService.getUnreadSummary();
        const totalUnread = emailSummary.reduce((s, a) => s + a.unread, 0);

        let todayEvents: Array<Record<string, unknown>> = [];
        try {
          const calAccounts = calendarService.loadAccounts();
          for (const acc of calAccounts) {
            const events = await calendarService.listEvents(acc, { from: today, to: tomorrow });
            todayEvents.push(...events.map((e) => ({ ...e, account: acc.name })));
          }
        } catch {}

        const allTodos = assistantStore.listTodos({ done: false });
        const overdueTodos = allTodos.filter((t) => t.dueDate && t.dueDate < today);
        const dueTodayTodos = allTodos.filter((t) => t.dueDate === today);

        const delegations = assistantStore.listDelegations();

        let activeSessions: Array<Record<string, unknown>> = [];
        try {
          const sessRes = await fetch(`${base}/sessions`, { headers });
          const sessData = await sessRes.json() as Array<Record<string, unknown>>;
          activeSessions = sessData
            .filter((s) => s.state !== "exited" && !s.archived)
            .map((s) => ({ id: s.sessionId, state: s.state, model: s.model, name: s.name }));
        } catch {}

        const projectTodos = assistantStore.listTodos();
        const projects: Record<string, { total: number; done: number; open: number }> = {};
        for (const t of projectTodos) {
          if (!t.project) continue;
          if (!projects[t.project]) projects[t.project] = { total: 0, done: 0, open: 0 };
          projects[t.project].total++;
          if (t.done) projects[t.project].done++;
          else projects[t.project].open++;
        }

        return {
          date: today,
          email: { accounts: emailSummary, totalUnread },
          calendar: { events: todayEvents, count: todayEvents.length },
          todos: { open: allTodos.length, overdue: overdueTodos.length, dueToday: dueTodayTodos.length, overdueItems: overdueTodos, dueTodayItems: dueTodayTodos },
          delegations: { items: delegations, count: delegations.length },
          sessions: { active: activeSessions, count: activeSessions.length },
          projects: Object.entries(projects).map(([name, p]) => ({ name, ...p })),
        };
      }

      // ─── Meeting Notes ──────────────────────────────────────────────
      case "create_meeting_notes": {
        const title = (args?.title as string) || "";
        const summary = (args?.summary as string) || "";
        if (!title || !summary) return { error: "title and summary are required" };

        const participants = args?.participants ? (args.participants as string).split(",").map((p: string) => p.trim()) : [];
        const actionItemTexts = args?.actionItems ? (args.actionItems as string).split(",").map((a: string) => a.trim()) : [];
        const callId = (args?.callId as string) || "";

        let content = summary;
        if (participants.length > 0) {
          content += `\n\nParticipants: ${participants.join(", ")}`;
        }
        if (callId) {
          content += `\n\nRelated call: ${callId}`;
        }

        const note = assistantStore.addNote(title, content, ["meeting"]);

        const todoIds: string[] = [];
        for (const item of actionItemTexts) {
          if (!item) continue;
          const todo = assistantStore.addTodo(item, "medium", "meeting-action");
          todoIds.push(todo.id);
        }

        return {
          noteId: note.id,
          todoIds,
          message: `Meeting notes "${title}" created${todoIds.length > 0 ? ` with ${todoIds.length} action item(s)` : ""}.`,
        };
      }

      // ─── Team Coordination ──────────────────────────────────────────
      case "run_team": {
        const goal = (args?.goal as string) || "";
        const cwd = (args?.cwd as string) || "";
        if (!goal || !cwd) {
          return { error: "goal and cwd are required" };
        }
        const suggestedAgents = args?.agents
          ? (args.agents as string).split(",").map((a: string) => a.trim()).filter(Boolean)
          : [];

        const { createTeam, ensureCoordinatorAgent, buildCoordinatorPrompt, updateTeamState } = await import("./team-service.js");
        const team = createTeam({ goal, repoRoot: cwd, suggestedAgents });

        const coordinatorId = ensureCoordinatorAgent();
        const apiBase = `http://127.0.0.1:${process.env.PORT || 3100}`;
        const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
        const systemPrompt = buildCoordinatorPrompt(team, apiBase, authToken);

        const runRes = await fetch(`${base}/agents/${coordinatorId}/run`, {
          method: "POST",
          headers,
          body: JSON.stringify({ input: goal, cwd }),
        });
        const runData = await runRes.json() as Record<string, unknown>;

        if (!runRes.ok) {
          return { error: `Failed to start Team Coordinator: ${(runData as { error?: string }).error || "Unknown error"}` };
        }

        const sessionId = (runData as { sessionId?: string }).sessionId || null;
        if (sessionId) {
          updateTeamState(team.id, "planning", { coordinatorSessionId: sessionId });

          // Inject system prompt via WebSocket bridge
          try {
            const wsBridgeModule = await import("./ws-bridge.js");
            // The system prompt needs to be injected; use the send-to-session endpoint
            await fetch(`${base}/gemini/send-to-session`, {
              method: "POST",
              headers,
              body: JSON.stringify({ sessionId, message: systemPrompt }),
            });
          } catch {
            // Best effort — the agent prompt will still work
          }
        }

        return {
          teamId: team.id,
          sessionId,
          message: "Team Coordinator started. Use monitor_team to track progress.",
        };
      }

      case "monitor_team": {
        const teamId = (args?.team_id as string) || "";
        if (!teamId) return { error: "team_id is required" };
        const { getTeamStatus } = await import("./team-service.js");
        const status = getTeamStatus(teamId);
        if (!status) return { error: "Team not found" };

        let summary = "";
        if (status.state === "completed") {
          summary = `Team completed! ${status.result || "All tasks finished."}`;
        } else if (status.state === "failed") {
          summary = `Team failed: ${status.error || "Unknown error"}`;
        } else {
          summary = `Team ${status.state}: ${status.tasksCompleted}/${status.tasksTotal} tasks completed, ${status.tasksRunning} running, ${status.tasksFailed} failed.`;
        }

        return { ...status, summary };
      }

      // ─── Content Engine ──────────────────────────────────────────────
      case "analyze_website": {
        const url = (args?.url as string) || "";
        if (!url) return { error: "url is required" };
        try {
          const { analyzeWebsite } = await import("./content-intelligence/content-engine.js");
          const intelligence = await analyzeWebsite(url);
          return {
            success: true,
            companyName: intelligence.companyName,
            businessType: intelligence.businessType,
            industry: intelligence.industry,
            language: intelligence.language,
            targetAudience: intelligence.targetAudience,
            tone: intelligence.tone,
            usp: intelligence.usp,
            products: intelligence.products.slice(0, 5),
            services: intelligence.services.slice(0, 5),
            colors: intelligence.colors,
            heroImages: intelligence.heroImages.length,
            crawledPages: intelligence.crawledPages.length,
            message: `Website analyzed: ${intelligence.companyName} (${intelligence.businessType}, ${intelligence.industry}). Found ${intelligence.products.length} products, ${intelligence.services.length} services. Tone: ${intelligence.tone}. Target: ${intelligence.targetAudience}.`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to analyze website" };
        }
      }

      case "create_content_strategy": {
        const url = (args?.url as string) || "";
        if (!url) return { error: "url is required" };
        const platformsStr = (args?.platforms as string) || "instagram,linkedin,facebook";
        const platforms = platformsStr.split(",").map((p: string) => p.trim()).filter(Boolean);
        try {
          const { analyzeWebsite, createContentStrategy } = await import("./content-intelligence/content-engine.js");
          const intelligence = await analyzeWebsite(url);
          const strategy = createContentStrategy(intelligence, platforms);
          return {
            success: true,
            businessType: strategy.businessType,
            pillars: strategy.pillars.map((p) => ({ name: p.name, painPoints: p.painPoints.length, ideas: p.contentIdeas.length })),
            schedules: strategy.schedules,
            tone: strategy.tone,
            ctas: strategy.ctas,
            journeyMapping: {
              attract: strategy.journeyMapping.attract.length,
              convert: strategy.journeyMapping.convert.length,
              close: strategy.journeyMapping.close.length,
            },
            message: `Content strategy created for ${intelligence.companyName}: ${strategy.pillars.length} content pillars, ${strategy.schedules.length} platform schedules. Tone: ${strategy.tone}.`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to create content strategy" };
        }
      }

      case "generate_content": {
        const url = (args?.url as string) || "";
        const platform = (args?.platform as string) || "";
        if (!url || !platform) return { error: "url and platform are required" };
        const count = (args?.count as number) || 5;
        const journeyStage = (args?.journeyStage as string) || undefined;
        const styleProfileHandle =
          typeof args?.styleProfileHandle === "string" && args.styleProfileHandle.trim()
            ? args.styleProfileHandle.trim()
            : undefined;
        try {
          const { analyzeWebsite, createContentStrategy, generateSmartContent } = await import("./content-intelligence/content-engine.js");
          const intelligence = await analyzeWebsite(url);
          const strategy = createContentStrategy(intelligence, [platform]);
          const pieces = await generateSmartContent({
            intelligence,
            strategy,
            platform,
            journeyStage: journeyStage as "attract" | "convert" | "close" | undefined,
            count,
            styleProfileHandle,
          });
          return {
            success: true,
            platform,
            count: pieces.length,
            pieces: pieces.map((p) => ({
              id: p.id,
              framework: p.framework,
              journeyStage: p.journeyStage,
              pillar: p.pillar,
              hook: p.hook,
              headline: p.headline,
              body: p.body.slice(0, 300) + (p.body.length > 300 ? "..." : ""),
              cta: p.cta,
              hashtags: p.hashtags,
              imagePrompt: p.imagePrompt,
            })),
            message: `Generated ${pieces.length} content pieces for ${platform}. Each includes hook, body, CTA, hashtags, and image prompt.`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to generate content" };
        }
      }

      case "generate_ad_creatives": {
        const url = (args?.url as string) || "";
        const platform = (args?.platform as string) || "";
        if (!url || !platform) return { error: "url and platform are required" };
        const count = (args?.count as number) || 3;
        try {
          const { analyzeWebsite, generateAdCreatives: genAds } = await import("./content-intelligence/content-engine.js");
          const intelligence = await analyzeWebsite(url);
          const ads = await genAds({ intelligence, platform, count });
          return {
            success: true,
            platform,
            count: ads.length,
            ads: ads.map((a) => ({
              id: a.id,
              format: a.format,
              aspectRatio: a.aspectRatio,
              resolution: a.resolution,
              headline: a.headline,
              body: a.body,
              cta: a.cta,
              imagePrompt: a.imagePrompt,
              brandColors: a.brandColors,
            })),
            message: `Generated ${ads.length} ad creatives for ${platform}. Each includes headline, body, CTA, and image prompt.`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to generate ad creatives" };
        }
      }

      case "generate_ads": {
        const url = (args?.url as string) || "";
        if (!url) return { error: "url is required" };
        const platformsStr = (args?.platforms as string) || "";
        const count = (args?.count as number) || 2;
        const style = (args?.style as string) || "professional";

        try {
          const { analyzeWebsite, generateAdCreatives: genAds } = await import("./content-intelligence/content-engine.js");
          const { generateImage } = await import("./google-media.js");
          const smManager = await import("./socialmedia/manager.js");

          // 1. Analyze website
          const intelligence = await analyzeWebsite(url);

          // 2. Determine platforms
          let platforms: string[];
          if (platformsStr) {
            platforms = platformsStr.split(",").map((p: string) => p.trim()).filter(Boolean);
          } else {
            try {
              const profiles = await smManager.getProfiles();
              platforms = [...new Set(profiles.map((p: { platform: string }) => p.platform))];
            } catch {
              platforms = ["instagram", "facebook", "linkedin"];
            }
          }

          // 3. Platform aspect ratio mapping
          const platformAspectRatios: Record<string, string> = {
            instagram: "3:4",
            facebook: "3:4",
            linkedin: "1:1",
            twitter: "16:9",
            tiktok: "9:16",
            youtube: "16:9",
          };

          const styleHints: Record<string, string> = {
            professional: "Clean, corporate design with subtle gradients, professional typography",
            bold: "High contrast, vibrant colors, large bold text, eye-catching",
            minimal: "Lots of whitespace, elegant, simple, one focal point",
            playful: "Colorful, casual, friendly, rounded shapes, fun elements",
          };

          const savedDrafts: Array<{ id: string; platform: string; headline: string; aspectRatio: string; imageUrl: string }> = [];

          // 4. For each platform: generate ads, images, save drafts
          for (const platform of platforms) {
            try {
              const ads = await genAds({ intelligence, platform, count });
              const aspectRatio = platformAspectRatios[platform] || "1:1";

              for (const ad of ads) {
                try {
                  // Generate image with brand context
                  const imagePrompt = `${styleHints[style] || styleHints.professional}. ${ad.imagePrompt}. Brand colors: ${intelligence.colors.slice(0, 3).join(", ") || "blue, white"}. Bold text overlay: "${ad.headline}". Aspect ratio: ${aspectRatio}`;

                  const images = await generateImage(imagePrompt, {
                    model: "gemini-3.1-flash-image-preview",
                    aspectRatio,
                  });

                  const mediaUrl = images.length > 0 ? `/api/media/file/${images[0].filename}` : undefined;

                  // Build ad text
                  const adText = `${ad.headline}\n\n${ad.body}\n\n${ad.cta}`;

                  // Save as draft
                  const draft = await smManager.createDraft({
                    text: adText,
                    platforms: [platform as any],
                    isDraft: true,
                    mediaUrls: mediaUrl ? [mediaUrl] : [],
                    createdBy: "agent",
                  });

                  savedDrafts.push({
                    id: draft.id,
                    platform,
                    headline: ad.headline,
                    aspectRatio,
                    imageUrl: mediaUrl || "",
                  });
                } catch (imgErr) {
                  // If image fails, still save draft without image
                  const adText = `${ad.headline}\n\n${ad.body}\n\n${ad.cta}`;
                  const draft = await smManager.createDraft({
                    text: adText,
                    platforms: [platform as any],
                    isDraft: true,
                    createdBy: "agent",
                  });
                  savedDrafts.push({
                    id: draft.id,
                    platform,
                    headline: ad.headline,
                    aspectRatio,
                    imageUrl: "",
                  });
                }
              }
            } catch (platErr) {
              console.error(`[generate_ads] Failed for platform ${platform}:`, platErr);
            }
          }

          return {
            success: true,
            company: intelligence.companyName,
            industry: intelligence.industry,
            brandColors: intelligence.colors.slice(0, 5),
            totalDrafts: savedDrafts.length,
            drafts: savedDrafts,
            message: `${savedDrafts.length} Ad-Drafts erstellt fuer ${intelligence.companyName}. Alle mit Bildern als Drafts gespeichert.`,
            link: "#/socialmedia/drafts",
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to generate ads" };
        }
      }

      case "generate_content_plan": {
        const url = (args?.url as string) || "";
        if (!url) return { error: "url is required" };
        const platformsStr = (args?.platforms as string) || "instagram,linkedin,facebook";
        const platforms = platformsStr.split(",").map((p: string) => p.trim()).filter(Boolean);
        const weeks = (args?.weeks as number) || 4;
        try {
          const { generateContentPlan } = await import("./content-intelligence/content-engine.js");
          const plan = await generateContentPlan({ url, platforms, weeks });

          // Save drafts via social media manager if possible
          let savedDrafts = 0;
          try {
            const smManager = await import("./socialmedia/manager.js");
            for (const [platformKey, pieces] of Object.entries(plan.content)) {
              for (const piece of pieces.slice(0, 10)) { // Cap at 10 drafts per platform
                await smManager.createDraft({
                  text: `${piece.headline}\n\n${piece.body}\n\n${piece.cta}\n\n${piece.hashtags.map((h: string) => `#${h.replace(/^#/, "")}`).join(" ")}`,
                  platforms: [platformKey] as import("./socialmedia/types.js").SocialPlatform[],
                  scheduledAt: null,
                  mediaUrls: [],
                  createdBy: "agent",
                });
                savedDrafts++;
              }
            }
          } catch {
            // Social media manager might not be configured — that's OK
          }

          const contentSummary: Record<string, number> = {};
          for (const [p, pieces] of Object.entries(plan.content)) {
            contentSummary[p] = pieces.length;
          }
          const adSummary: Record<string, number> = {};
          for (const [p, ads] of Object.entries(plan.ads)) {
            adSummary[p] = ads.length;
          }

          return {
            success: true,
            companyName: plan.intelligence.companyName,
            businessType: plan.intelligence.businessType,
            weeks,
            platforms,
            contentPieces: contentSummary,
            adCreatives: adSummary,
            pillars: plan.strategy.pillars.map((p) => p.name),
            savedDrafts,
            message: `Content plan generated for ${plan.intelligence.companyName}: ${Object.values(contentSummary).reduce((a, b) => a + b, 0)} content pieces and ${Object.values(adSummary).reduce((a, b) => a + b, 0)} ad creatives across ${platforms.length} platforms for ${weeks} weeks.${savedDrafts > 0 ? ` ${savedDrafts} drafts saved to Social Media.` : ""}`,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to generate content plan" };
        }
      }

      // ─── Documents ────────────────────────────────────────────────
      case "list_documents": {
        const docStore = await import("./ceo/document-store.js");
        const folder = (args?.folder as string) || undefined;
        const tag = (args?.tag as string) || undefined;
        const docs = docStore.listDocuments(folder, tag);
        return { documents: docs, count: docs.length, message: docs.length > 0 ? `Found ${docs.length} document(s).` : "No documents found." };
      }

      case "upload_document": {
        const title = (args?.title as string) || "";
        const content = (args?.content as string) || "";
        const fileType = (args?.fileType as string) || "txt";
        if (!title || !content) return { error: "title and content are required" };
        const docStore = await import("./ceo/document-store.js");
        const tagsStr = (args?.tags as string) || "";
        const tags = tagsStr ? tagsStr.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
        const doc = docStore.addDocument(title, content, fileType, (args?.folder as string) || undefined, tags, (args?.summary as string) || undefined);
        return { document: doc, message: `Document "${title}" saved.` };
      }

      case "get_document": {
        const id = (args?.id as string) || "";
        if (!id) return { error: "id is required" };
        const docStore = await import("./ceo/document-store.js");
        const result = docStore.getDocument(id);
        if (!result) return { error: "Document not found" };
        return result;
      }

      case "search_documents": {
        const query = (args?.query as string) || "";
        if (!query) return { error: "query is required" };
        const docStore = await import("./ceo/document-store.js");
        const docs = docStore.searchDocuments(query);
        return { documents: docs, count: docs.length, message: docs.length > 0 ? `Found ${docs.length} document(s) matching "${query}".` : `No documents found for "${query}".` };
      }

      case "delete_document": {
        const id = (args?.id as string) || "";
        if (!id) return { error: "id is required" };
        const docStore = await import("./ceo/document-store.js");
        const ok = docStore.deleteDocument(id);
        return ok ? { message: "Document deleted." } : { error: "Document not found" };
      }

      // ─── Templates ────────────────────────────────────────────────
      case "list_templates": {
        const tplStore = await import("./ceo/template-store.js");
        const category = (args?.category as string) || undefined;
        const templates = tplStore.listTemplates(category);
        return { templates, count: templates.length, message: templates.length > 0 ? `Found ${templates.length} template(s).` : "No templates found." };
      }

      case "create_template": {
        const tplName = (args?.name as string) || "";
        const tplContent = (args?.content as string) || "";
        const tplCategory = (args?.category as string) || "custom";
        if (!tplName || !tplContent) return { error: "name and content are required" };
        const tplStore = await import("./ceo/template-store.js");
        const tagsStr = (args?.tags as string) || "";
        const tags = tagsStr ? tagsStr.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
        const tpl = tplStore.createTemplate(tplName, tplContent, tplCategory, undefined, tags);
        return { template: tpl, message: `Template "${tplName}" created with ${tpl.variables.length} variable(s).` };
      }

      case "use_template": {
        const tplId = (args?.id as string) || "";
        if (!tplId) return { error: "id is required" };
        const tplStore = await import("./ceo/template-store.js");
        let variables: Record<string, string> = {};
        try {
          const varsStr = (args?.variables as string) || "{}";
          variables = JSON.parse(varsStr);
        } catch { return { error: "variables must be a valid JSON object" }; }
        const result = tplStore.useTemplate(tplId, variables);
        if (!result) return { error: "Template not found" };
        return { result: result.result, templateName: result.template.name, message: `Template "${result.template.name}" filled.` };
      }

      case "search_templates": {
        const query = (args?.query as string) || "";
        if (!query) return { error: "query is required" };
        const tplStore = await import("./ceo/template-store.js");
        const templates = tplStore.searchTemplates(query);
        return { templates, count: templates.length };
      }

      case "delete_template": {
        const id = (args?.id as string) || "";
        if (!id) return { error: "id is required" };
        const tplStore = await import("./ceo/template-store.js");
        const ok = tplStore.deleteTemplate(id);
        return ok ? { message: "Template deleted." } : { error: "Template not found" };
      }

      // ─── News & Monitoring ────────────────────────────────────────
      case "add_news_source": {
        const nsName = (args?.name as string) || "";
        const nsType = (args?.type as string) || "";
        const nsCat = (args?.category as string) || "";
        if (!nsName || !nsType || !nsCat) return { error: "name, type, and category are required" };
        const newsStore = await import("./ceo/news-store.js");
        const kwStr = (args?.keywords as string) || "";
        const keywords = kwStr ? kwStr.split(",").map((k: string) => k.trim()).filter(Boolean) : undefined;
        const source = newsStore.addSource(nsName, nsType as "rss" | "website" | "keyword", nsCat, (args?.url as string) || undefined, keywords, (args?.checkInterval as number) || undefined);
        return { source, message: `News source "${nsName}" added.` };
      }

      case "list_news_sources": {
        const newsStore = await import("./ceo/news-store.js");
        const sources = newsStore.listSources();
        return { sources, count: sources.length };
      }

      case "list_news": {
        const newsStore = await import("./ceo/news-store.js");
        const items = newsStore.listNews(
          (args?.category as string) || undefined,
          (args?.unreadOnly as boolean) || false,
          false,
          (args?.limit as number) || 20
        );
        return { items, count: items.length, message: items.length > 0 ? `${items.length} news item(s).` : "No news." };
      }

      case "search_news": {
        const query = (args?.query as string) || "";
        if (!query) return { error: "query is required" };
        const newsStore = await import("./ceo/news-store.js");
        const items = newsStore.searchNews(query);
        return { items, count: items.length };
      }

      case "mark_news_read": {
        const id = (args?.id as string) || "";
        if (!id) return { error: "id is required" };
        const newsStore = await import("./ceo/news-store.js");
        const ok = newsStore.markRead(id);
        return ok ? { message: "Marked as read." } : { error: "News item not found" };
      }

      case "get_news_stats": {
        const newsStore = await import("./ceo/news-store.js");
        return newsStore.getNewsStats();
      }

      // ─── Time Tracking ────────────────────────────────────────────
      case "start_timer": {
        const task = (args?.task as string) || "";
        if (!task) return { error: "task is required" };
        const timeStore = await import("./ceo/time-tracking-store.js");
        const timer = timeStore.startTimer(task, (args?.project as string) || undefined, (args?.category as string) || undefined);
        return { timer, message: `Timer started for "${task}".` };
      }

      case "stop_timer": {
        const timeStore = await import("./ceo/time-tracking-store.js");
        const entry = timeStore.stopTimer((args?.notes as string) || undefined);
        if (!entry) return { error: "No active timer" };
        return { entry, message: `Timer stopped. ${entry.duration} minutes logged for "${entry.task}".` };
      }

      case "get_active_timer": {
        const timeStore = await import("./ceo/time-tracking-store.js");
        const timer = timeStore.getActiveTimer();
        if (!timer) return { message: "No active timer." };
        const elapsed = Math.round((Date.now() - new Date(timer.startTime).getTime()) / 60000);
        return { timer, elapsed, message: `Timer running for "${timer.task}" — ${elapsed} minutes.` };
      }

      case "log_time": {
        const task = (args?.task as string) || "";
        const duration = (args?.duration as number) || 0;
        if (!task || !duration) return { error: "task and duration are required" };
        const timeStore = await import("./ceo/time-tracking-store.js");
        const entry = timeStore.logTime(task, duration, (args?.project as string) || undefined, (args?.category as string) || undefined, (args?.notes as string) || undefined, (args?.date as string) || undefined);
        return { entry, message: `${duration} minutes logged for "${task}".` };
      }

      case "get_time_report": {
        const timeStore = await import("./ceo/time-tracking-store.js");
        const period = (args?.period as string) || "week";
        const report = timeStore.getReport(period as "today" | "week" | "month");
        const hours = Math.round(report.totalMinutes / 60 * 10) / 10;
        return { ...report, message: `${period} report: ${hours} hours total across ${Object.keys(report.byProject).length} project(s).` };
      }

      // ─── Finance & Invoices ───────────────────────────────────────
      case "create_invoice": {
        const clientName = (args?.clientName as string) || "";
        if (!clientName) return { error: "clientName is required" };
        const finStore = await import("./ceo/finance-store.js");
        let items;
        try {
          const itemsStr = (args?.items as string) || "[]";
          items = JSON.parse(itemsStr);
        } catch { return { error: "items must be a valid JSON array" }; }
        const invoice = finStore.createInvoice(clientName, items, {
          clientEmail: (args?.clientEmail as string) || undefined,
          taxRate: (args?.taxRate as number) || undefined,
          currency: (args?.currency as string) || undefined,
          dueDate: (args?.dueDate as string) || undefined,
          notes: (args?.notes as string) || undefined,
        });
        return { invoice, message: `Invoice ${invoice.invoiceNumber} created for ${clientName}: ${invoice.total} ${invoice.currency}.` };
      }

      case "list_invoices": {
        const finStore = await import("./ceo/finance-store.js");
        const invoices = finStore.listInvoices((args?.status as string) || undefined);
        const total = invoices.reduce((s, i) => s + i.total, 0);
        return { invoices, count: invoices.length, total, message: `${invoices.length} invoice(s), total: ${total.toFixed(2)}.` };
      }

      case "mark_invoice_paid": {
        const id = (args?.id as string) || "";
        if (!id) return { error: "id is required" };
        const finStore = await import("./ceo/finance-store.js");
        const invoice = finStore.markPaid(id);
        if (!invoice) return { error: "Invoice not found" };
        return { invoice, message: `Invoice ${invoice.invoiceNumber} marked as paid.` };
      }

      case "log_expense": {
        const desc = (args?.description as string) || "";
        const amount = (args?.amount as number) || 0;
        const cat = (args?.category as string) || "";
        if (!desc || !amount || !cat) return { error: "description, amount, and category are required" };
        const finStore = await import("./ceo/finance-store.js");
        const expense = finStore.logExpense(desc, amount, cat, {
          vendor: (args?.vendor as string) || undefined,
          project: (args?.project as string) || undefined,
          date: (args?.date as string) || undefined,
          notes: (args?.notes as string) || undefined,
        });
        return { expense, message: `Expense logged: ${desc} — ${amount} ${expense.currency}.` };
      }

      case "list_expenses": {
        const finStore = await import("./ceo/finance-store.js");
        const expenses = finStore.listExpenses(
          (args?.category as string) || undefined,
          (args?.startDate as string) || undefined,
          (args?.endDate as string) || undefined
        );
        const total = expenses.reduce((s, e) => s + e.amount, 0);
        return { expenses, count: expenses.length, total, message: `${expenses.length} expense(s), total: ${total.toFixed(2)}.` };
      }

      case "get_financial_summary": {
        const finStore = await import("./ceo/finance-store.js");
        const period = (args?.period as string) || "month";
        const summary = finStore.getFinancialSummary(period as "month" | "quarter" | "year");
        return { ...summary, message: `${period} summary: Revenue ${summary.totalRevenue.toFixed(2)}, Expenses ${summary.totalExpenses.toFixed(2)}, Profit ${summary.netProfit.toFixed(2)} ${summary.currency}.` };
      }

      // ─── KPI Dashboard ────────────────────────────────────────────
      case "define_kpi": {
        const kpiName = (args?.name as string) || "";
        const unit = (args?.unit as string) || "";
        const category = (args?.category as string) || "";
        if (!kpiName || !unit || !category) return { error: "name, unit, and category are required" };
        const kpiStore = await import("./ceo/kpi-store.js");
        const kpi = kpiStore.defineKPI(kpiName, unit, category, {
          description: (args?.description as string) || undefined,
          target: (args?.target as number) || undefined,
          direction: (args?.direction as "up" | "down") || undefined,
        });
        return { kpi, message: `KPI "${kpiName}" defined${kpi.target ? ` with target ${kpi.target} ${unit}` : ""}.` };
      }

      case "record_kpi_value": {
        const kpiId = (args?.kpiId as string) || "";
        const value = args?.value as number;
        if (!kpiId || value === undefined) return { error: "kpiId and value are required" };
        const kpiStore = await import("./ceo/kpi-store.js");
        const kpi = kpiStore.recordValue(kpiId, value, (args?.date as string) || undefined, (args?.note as string) || undefined);
        if (!kpi) return { error: "KPI not found" };
        return { kpi, message: `KPI "${kpi.name}" updated: ${value} ${kpi.unit}${kpi.trend ? ` (${kpi.trend} ${kpi.trendPercent}%)` : ""}.` };
      }

      case "get_kpi_dashboard": {
        const kpiStore = await import("./ceo/kpi-store.js");
        const dashboard = kpiStore.getDashboard();
        return { ...dashboard, message: `${dashboard.summary.total} KPI(s): ${dashboard.summary.onTarget} on target, ${dashboard.summary.warning} warning, ${dashboard.summary.critical} critical.` };
      }

      case "get_kpi_history": {
        const kpiId = (args?.kpiId as string) || "";
        if (!kpiId) return { error: "kpiId is required" };
        const kpiStore = await import("./ceo/kpi-store.js");
        const period = (args?.period as string) || undefined;
        const history = kpiStore.getKPIHistory(kpiId, period as "week" | "month" | "quarter" | "year" | undefined);
        return { history, count: history.length };
      }

      case "delete_kpi": {
        const id = (args?.id as string) || "";
        if (!id) return { error: "id is required" };
        const kpiStore = await import("./ceo/kpi-store.js");
        const ok = kpiStore.deleteKPI(id);
        return ok ? { message: "KPI deleted." } : { error: "KPI not found" };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

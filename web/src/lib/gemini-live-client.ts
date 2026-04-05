// ─── Gemini Live WebSocket Client ────────────────────────────────────────────
// Manages a bidirectional audio stream with Gemini's BidiGenerateContent API.
// Supports function calling to control HeyHank sessions.

import { base64ToUint8Array } from "./gemini-audio.js";

const WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const MODEL = "models/gemini-3.1-flash-live-preview";

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  backend: string;
}

interface ConversationContext {
  title: string;
  content: string;
}

interface ActiveSession {
  sessionId: string;
  state: string;
  model?: string;
  agentName?: string;
  cwd?: string;
}

function buildSystemPrompt(assistantName: string, agents: AgentInfo[], recentConversations?: ConversationContext[], activeSessions?: ActiveSession[]): string {
  const nameIntro = assistantName
    ? `You are "${assistantName}", a personal voice assistant on the HeyHank platform.`
    : `You are a personal voice assistant on the HeyHank platform.`;

  const agentSection = agents.length > 0
    ? `\nAGENTS (configured on the platform):
The following agents are available. You are the orchestrator — when the user assigns a task,
choose the appropriate agent and start it with run_agent (NOT create_session!).
run_agent uses the full agent profile with the correct model, prompt and permissions.

${agents.map((a) => `- "${a.name}" (${a.backend}): ${a.description}`).join("\n")}

When the user mentions an agent name (even approximately, e.g. "Max 2.0" for "Agent Max 2.0"),
recognize it and start the appropriate session. Only ask if it is truly unclear.`
    : "";

  return `${nameIntro}
You speak English by default, unless the user speaks another language.
Keep your answers short and natural — you are a voice assistant, not a text bot.

You are the central assistant and orchestrator of the platform with the following capabilities:
${agentSection}

AGENT CONTROL:
- create_agent: Create a new specialized agent when no existing agent fits the task.
  Provide a name, description, and detailed system prompt. You can optionally auto-start it.
  Use this when the user asks for a task that requires a new agent type (e.g. "create an agent for data analysis").
- run_agent: Start an agent with a task (PREFERRED for all configured agents!)
  The agent starts with its full profile (model, prompt, permissions, working directory).
  Returns a session_id — REMEMBER this for monitoring!
  Example: run_agent("Agent Max 2.0", "Create a website for...")
- monitor_agent_session: Check the status of a running agent
  IMPORTANT: After every run_agent you MUST call monitor_agent_session to check progress!
  Call it multiple times (every few seconds) until the agent is done or has questions.
  If the agent has questions (needsInput=true) → immediately inform the user!
  If the agent is done (isCompleted=true) → inform the user that the task is completed.
- list_sessions: show active sessions
- create_session: start a new blank session (only if no matching agent exists)
- send_message: send a message to a running session
- get_session_status: check the status of a session

TODOS (task list):
- list_todos: show open tasks (filterable by priority/category)
- add_todo: add new task
- complete_todo: mark task as completed
- update_todo: update a task
- delete_todo: delete a task
Categories e.g.: work, personal, shopping, project

NOTES (memory):
- search_notes: search notes ("what do you know about X?")
- add_note: save a note ("remember that...", "note that...")
- update_note / delete_note: manage notes

REMINDERS:
- list_reminders: show pending reminders
- add_reminder: set a reminder ("remind me in 2 hours about X")
  Current timezone: Europe/Vienna
- delete_reminder: delete a reminder

EMAIL:
- list_email_accounts: show configured email accounts
- list_emails: list emails of an account (optional: unread only)
- read_email: read an email (by UID)
- search_emails: search emails
- send_email: send an email
- reply_email: reply to an email
- email_summary: unread emails across all accounts

CALENDAR:
- list_calendar_accounts: show configured calendar accounts
- list_events: list events of an account (default: next 7 days)
- create_event: create an event ("schedule a meeting", "appointment on Friday")
- search_events: search events by text
- delete_event: delete an event (by UID)
- calendar_summary: overview of upcoming events across all accounts

Use the tools proactively. If the user says "I still need to do X", add it as a todo.
If they say "don't forget" or "remember that", save a note.
If they mention a time, set a reminder.
If they ask about emails, use email_summary for an overview or list_emails for details.
If they ask about events ("what's on today?", "do I have anything tomorrow?"), use calendar_summary or list_events.
If they want to create an event ("schedule a...", "meeting on..."), use create_event.
If the user assigns a complex task (create a website, write code, etc.), delegate to the appropriate agent.

TELEPHONY (phone calls):
- make_call: Place a real phone call via SIP trunk. The AI on the other end conducts the conversation autonomously.
  Example: "Call the restaurant and reserve a table" → make_call("+4312345678", "Reserve a table for 4 at 7pm Friday")
- list_active_calls: Show current active phone calls
- end_active_call: Hang up an active call
After starting a call, inform the user about the status. The call runs autonomously — you don't need to monitor it.

INTERNET SEARCH:
You have access to Google Search (automatically integrated). When the user asks for current information
("what is...", "search for...", "what's the weather", "current news", etc.), use Google Search.
You can use it to retrieve current information from the internet.

IMPORTANT — AGENT MONITORING:
After starting an agent with run_agent:
1. Remember the session_id from the response
2. Immediately call monitor_agent_session to check the status
3. If the agent is still working (isWorking=true), wait briefly and check again
4. If the agent has questions (needsInput=true), inform the user IMMEDIATELY
5. If the agent is done (isCompleted=true), let the user know
You are responsible for communicating progress to the user!${activeSessions && activeSessions.length > 0 ? `

ACTIVE SESSIONS (currently running):
${activeSessions.map((s) => `- ${s.agentName || s.sessionId}: Status=${s.state}${s.model ? `, Model=${s.model}` : ""}${s.cwd ? `, Dir=${s.cwd}` : ""}`).join("\n")}
You can monitor these sessions with monitor_agent_session or get_session_status.
Proactively inform the user about running agents when they ask "what's running right now?".` : ""}${recentConversations && recentConversations.length > 0 ? `

CONVERSATION MEMORY:
Here are the recent conversations for context:
${recentConversations.map((c) => `--- ${c.title} ---\n${c.content}`).join("\n\n")}
Use this knowledge to maintain context.` : ""}`;
}

/** Tool declarations for Gemini function calling */
const TOOL_DECLARATIONS = [{
  functionDeclarations: [
    {
      name: "run_agent",
      description: "Run a configured agent by name or ID. This starts the agent with its full configuration (system prompt, model, permissions, working directory). Use this when the user asks to activate/start a specific agent like 'Max 2.0' or 'Coding Agent'. The agent will execute the given task autonomously.",
      parameters: {
        type: "OBJECT",
        properties: {
          agent: {
            type: "STRING",
            description: "Agent name or ID (e.g. 'Agent Max 2.0', 'Coding Agent', 'agent-max-20'). Fuzzy matching is supported.",
          },
          task: {
            type: "STRING",
            description: "The task/instruction to give to the agent.",
          },
        },
        required: ["agent", "task"],
      },
    },
    {
      name: "create_agent",
      description: "Create a new agent on the platform. Use this when the user wants a new specialized agent that doesn't exist yet. The agent will be saved and can be started later with run_agent.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: {
            type: "STRING",
            description: "Name for the agent (e.g. 'Website Builder', 'Data Analyst')",
          },
          description: {
            type: "STRING",
            description: "Short description of what the agent does",
          },
          prompt: {
            type: "STRING",
            description: "System prompt / instructions for the agent. Be detailed about the agent's role, capabilities, and how it should approach tasks.",
          },
          model: {
            type: "STRING",
            description: "AI model to use. Default: 'claude-sonnet-4-20250514'. Options: 'claude-sonnet-4-20250514', 'claude-opus-4-20250514'",
          },
          cwd: {
            type: "STRING",
            description: "Working directory for the agent. Default: home directory.",
          },
          autoStart: {
            type: "BOOLEAN",
            description: "If true, immediately start the agent with a task after creation. Default: false.",
          },
          task: {
            type: "STRING",
            description: "Task to give the agent if autoStart is true.",
          },
        },
        required: ["name", "prompt"],
      },
    },
    {
      name: "list_sessions",
      description: "List all active coding sessions on the platform. Returns session IDs, status, model, and working directory.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "create_session",
      description: "Create a new coding session with Claude Code or Codex. Returns the new session ID.",
      parameters: {
        type: "OBJECT",
        properties: {
          backend: {
            type: "STRING",
            description: "The AI backend to use: 'claude' for Claude Code, 'codex' for OpenAI Codex. Default: 'claude'.",
            enum: ["claude", "codex"],
          },
          cwd: {
            type: "STRING",
            description: "Working directory for the session. Default: /opt/agentplatform/web",
          },
          message: {
            type: "STRING",
            description: "Optional initial message to send to the session after creation.",
          },
        },
      },
    },
    {
      name: "send_message",
      description: "Send a text message/instruction to an existing coding session. The AI in that session will execute it.",
      parameters: {
        type: "OBJECT",
        properties: {
          session_id: {
            type: "STRING",
            description: "The session ID to send the message to. Use list_sessions to find available sessions.",
          },
          message: {
            type: "STRING",
            description: "The message/instruction to send to the session.",
          },
        },
        required: ["session_id", "message"],
      },
    },
    {
      name: "get_session_status",
      description: "Get detailed status of a specific session including state, model, and recent activity.",
      parameters: {
        type: "OBJECT",
        properties: {
          session_id: {
            type: "STRING",
            description: "The session ID to check.",
          },
        },
        required: ["session_id"],
      },
    },
    {
      name: "monitor_agent_session",
      description: "Monitor a running agent session. Returns whether the agent needs user input (permission questions), is still working, or has completed. IMPORTANT: After starting an agent with run_agent, use this tool periodically to check progress and immediately inform the user about questions or completion.",
      parameters: {
        type: "OBJECT",
        properties: {
          session_id: {
            type: "STRING",
            description: "The session ID returned by run_agent.",
          },
        },
        required: ["session_id"],
      },
    },
    // ─── Todo Tools ─────────────────────────────────────────────────
    {
      name: "list_todos",
      description: "List all todos/tasks. Can filter by status, priority or category.",
      parameters: {
        type: "OBJECT",
        properties: {
          show_completed: {
            type: "BOOLEAN",
            description: "If true, also show completed todos. Default: false (only open todos).",
          },
          priority: {
            type: "STRING",
            description: "Filter by priority.",
            enum: ["high", "medium", "low"],
          },
          category: {
            type: "STRING",
            description: "Filter by category (e.g. 'arbeit', 'privat', 'projekt').",
          },
        },
      },
    },
    {
      name: "add_todo",
      description: "Add a new todo/task to the list.",
      parameters: {
        type: "OBJECT",
        properties: {
          text: {
            type: "STRING",
            description: "The todo text/description.",
          },
          priority: {
            type: "STRING",
            description: "Priority level. Default: 'medium'.",
            enum: ["high", "medium", "low"],
          },
          category: {
            type: "STRING",
            description: "Optional category (e.g. 'arbeit', 'privat', 'projekt').",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "complete_todo",
      description: "Mark a todo as completed.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "The todo ID to complete." },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_todo",
      description: "Delete a todo permanently.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "The todo ID to delete." },
        },
        required: ["id"],
      },
    },
    {
      name: "update_todo",
      description: "Update an existing todo's text, priority or category.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "The todo ID to update." },
          text: { type: "STRING", description: "New text." },
          priority: { type: "STRING", enum: ["high", "medium", "low"] },
          category: { type: "STRING", description: "New category." },
        },
        required: ["id"],
      },
    },
    // ─── Note Tools ──────────────────────────────────────────────────
    {
      name: "search_notes",
      description: "Search notes/memory. Returns all notes if no query given. Use this when the user asks 'what do you know about X' or 'did I note something about Y'.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Search term to filter notes by title, content or tags. Leave empty to list all.",
          },
        },
      },
    },
    {
      name: "add_note",
      description: "Save a note/memory. Use when user says 'remember that...', 'note that...', 'save that...'.",
      parameters: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "Short title for the note." },
          content: { type: "STRING", description: "Detailed content." },
          tags: { type: "STRING", description: "Comma-separated tags for categorization." },
        },
        required: ["title"],
      },
    },
    {
      name: "update_note",
      description: "Update an existing note.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "The note ID." },
          title: { type: "STRING" },
          content: { type: "STRING" },
          tags: { type: "STRING", description: "Comma-separated tags." },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_note",
      description: "Delete a note.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "The note ID to delete." },
        },
        required: ["id"],
      },
    },
    // ─── Reminder Tools ──────────────────────────────────────────────
    {
      name: "list_reminders",
      description: "List all pending reminders.",
      parameters: {
        type: "OBJECT",
        properties: {
          include_fired: {
            type: "BOOLEAN",
            description: "If true, also show already fired reminders.",
          },
        },
      },
    },
    {
      name: "add_reminder",
      description: "Set a reminder for a specific time. Use when user says 'remind me in 2 hours' or 'remind me tomorrow at 9'.",
      parameters: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING", description: "What to be reminded about." },
          trigger_at: {
            type: "STRING",
            description: "ISO 8601 datetime when the reminder should fire. Calculate from current time if user says 'in 2 hours' etc. Current timezone is Europe/Vienna (CET/CEST).",
          },
        },
        required: ["text", "trigger_at"],
      },
    },
    {
      name: "delete_reminder",
      description: "Delete/cancel a reminder.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "The reminder ID to delete." },
        },
        required: ["id"],
      },
    },
    // ─── Email Tools ──────────────────────────────────────────────────
    {
      name: "list_email_accounts",
      description: "List all configured email accounts. Shows account name and email address.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "list_emails",
      description: "List recent emails from a specific account. Use list_email_accounts first to get the account name.",
      parameters: {
        type: "OBJECT",
        properties: {
          account: {
            type: "STRING",
            description: "Account name or email address (e.g. 'Gmail', 'Work', 'user@example.com').",
          },
          folder: {
            type: "STRING",
            description: "Mail folder. Default: INBOX.",
          },
          limit: {
            type: "NUMBER",
            description: "Number of emails to fetch. Default: 10.",
          },
          unseen: {
            type: "BOOLEAN",
            description: "If true, only show unread emails.",
          },
        },
        required: ["account"],
      },
    },
    {
      name: "read_email",
      description: "Read the full content of a specific email by UID. Use list_emails first to get the UID.",
      parameters: {
        type: "OBJECT",
        properties: {
          account: {
            type: "STRING",
            description: "Account name or email address.",
          },
          uid: {
            type: "NUMBER",
            description: "The email UID from list_emails.",
          },
          folder: {
            type: "STRING",
            description: "Mail folder. Default: INBOX.",
          },
        },
        required: ["account", "uid"],
      },
    },
    {
      name: "search_emails",
      description: "Search emails in an account by subject, sender, or body text.",
      parameters: {
        type: "OBJECT",
        properties: {
          account: {
            type: "STRING",
            description: "Account name or email address.",
          },
          query: {
            type: "STRING",
            description: "Search term to find in subject, from, or body.",
          },
          limit: {
            type: "NUMBER",
            description: "Max results. Default: 10.",
          },
        },
        required: ["account", "query"],
      },
    },
    {
      name: "send_email",
      description: "Send a new email from one of the configured accounts.",
      parameters: {
        type: "OBJECT",
        properties: {
          account: {
            type: "STRING",
            description: "Account name or email address to send from.",
          },
          to: {
            type: "STRING",
            description: "Recipient email address.",
          },
          subject: {
            type: "STRING",
            description: "Email subject line.",
          },
          body: {
            type: "STRING",
            description: "Email body text.",
          },
        },
        required: ["account", "to", "subject", "body"],
      },
    },
    {
      name: "reply_email",
      description: "Reply to an existing email. Automatically uses Re: subject and correct recipient.",
      parameters: {
        type: "OBJECT",
        properties: {
          account: {
            type: "STRING",
            description: "Account name or email address.",
          },
          uid: {
            type: "NUMBER",
            description: "UID of the email to reply to.",
          },
          body: {
            type: "STRING",
            description: "Reply body text.",
          },
          folder: {
            type: "STRING",
            description: "Mail folder of the original email. Default: INBOX.",
          },
        },
        required: ["account", "uid", "body"],
      },
    },
    {
      name: "email_summary",
      description: "Get unread email count across all configured accounts. Good for a quick overview.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    // ─── Calendar Tools ──────────────────────────────────────────────
    {
      name: "list_calendar_accounts",
      description: "List all configured calendar accounts. Shows account name and provider.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "list_events",
      description: "List calendar events for a date range. Default: next 7 days. Use list_calendar_accounts first to get the account name.",
      parameters: {
        type: "OBJECT",
        properties: {
          account: {
            type: "STRING",
            description: "Calendar account name (e.g. 'Google', 'iCloud'). Use list_calendar_accounts to find available accounts.",
          },
          from: {
            type: "STRING",
            description: "Start date/time in ISO format (e.g. '2026-04-03'). Default: today.",
          },
          to: {
            type: "STRING",
            description: "End date/time in ISO format (e.g. '2026-04-10'). Default: 7 days from now.",
          },
        },
        required: ["account"],
      },
    },
    {
      name: "create_event",
      description: "Create a new calendar event. Use when the user says 'add to calendar', 'schedule a meeting', etc.",
      parameters: {
        type: "OBJECT",
        properties: {
          account: {
            type: "STRING",
            description: "Calendar account name.",
          },
          summary: {
            type: "STRING",
            description: "Event title/summary.",
          },
          start: {
            type: "STRING",
            description: "Start date/time in ISO format (e.g. '2026-04-05T14:00:00' or '2026-04-05' for all-day).",
          },
          end: {
            type: "STRING",
            description: "End date/time in ISO format (e.g. '2026-04-05T15:00:00' or '2026-04-06' for all-day).",
          },
          description: {
            type: "STRING",
            description: "Optional event description/notes.",
          },
          location: {
            type: "STRING",
            description: "Optional event location.",
          },
          all_day: {
            type: "BOOLEAN",
            description: "If true, create an all-day event. Default: false.",
          },
        },
        required: ["account", "summary", "start", "end"],
      },
    },
    {
      name: "search_events",
      description: "Search calendar events by text in title, description or location.",
      parameters: {
        type: "OBJECT",
        properties: {
          account: {
            type: "STRING",
            description: "Calendar account name.",
          },
          query: {
            type: "STRING",
            description: "Search text to find in event title, description or location.",
          },
          from: {
            type: "STRING",
            description: "Start of search range. Default: today.",
          },
          to: {
            type: "STRING",
            description: "End of search range. Default: 30 days from now.",
          },
        },
        required: ["account", "query"],
      },
    },
    {
      name: "delete_event",
      description: "Delete a calendar event by its UID. Use list_events or search_events first to find the UID.",
      parameters: {
        type: "OBJECT",
        properties: {
          account: {
            type: "STRING",
            description: "Calendar account name.",
          },
          uid: {
            type: "STRING",
            description: "The event UID to delete (from list_events).",
          },
        },
        required: ["account", "uid"],
      },
    },
    {
      name: "calendar_summary",
      description: "Get an overview of upcoming events across all configured calendar accounts. Shows today's count, this week's count, and next event.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    // ─── Telephony Tools ──────────────────────────────────────────────
    {
      name: "make_call",
      description: "Place a real phone call to a phone number. An AI assistant will conduct the conversation autonomously based on the given task. The call goes through a real SIP trunk to the actual phone network. Use when the user asks to 'call someone', 'phone', 'ring', or 'reserve by phone'.",
      parameters: {
        type: "OBJECT",
        properties: {
          phone: {
            type: "STRING",
            description: "Phone number in E.164 format (e.g. '+4366412345', '+49301234567'). Include country code.",
          },
          task: {
            type: "STRING",
            description: "The task/instruction for the AI on the call. Be specific about what to say and achieve.",
          },
          voice: {
            type: "STRING",
            description: "Voice for the call AI. Default: same as current voice.",
          },
        },
        required: ["phone", "task"],
      },
    },
    {
      name: "list_active_calls",
      description: "List currently active phone calls with their status and duration.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "end_active_call",
      description: "Hang up an active phone call by its call ID.",
      parameters: {
        type: "OBJECT",
        properties: {
          call_id: {
            type: "STRING",
            description: "The call ID to hang up.",
          },
        },
        required: ["call_id"],
      },
    },
  ],
}];

export interface GeminiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type GeminiLiveEvent =
  | { type: "setupComplete" }
  | { type: "audio"; data: Uint8Array }
  | { type: "turnComplete" }
  | { type: "error"; error: string }
  | { type: "closed" }
  | { type: "interrupted" }
  | { type: "toolCall"; calls: GeminiToolCall[] }
  | { type: "text"; text: string }
  | { type: "inputTranscript"; text: string };

export type GeminiLiveEventHandler = (event: GeminiLiveEvent) => void;

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private handler: GeminiLiveEventHandler;
  private setupDone = false;

  constructor(handler: GeminiLiveEventHandler) {
    this.handler = handler;
  }

  /** Connect to Gemini Live using an API key and optional voice */
  connect(apiKey: string, voice: string = "Kore", config?: { assistantName?: string; agents?: AgentInfo[]; recentConversations?: ConversationContext[]; activeSessions?: ActiveSession[] }): void {
    const url = `${WS_BASE}?key=${apiKey}`;
    this.ws = new WebSocket(url);

    const systemPrompt = buildSystemPrompt(
      config?.assistantName || "",
      config?.agents || [],
      config?.recentConversations,
      config?.activeSessions,
    );

    this.ws.onopen = () => {
      // Send setup message with tools
      this.ws?.send(JSON.stringify({
        setup: {
          model: MODEL,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          tools: [...TOOL_DECLARATIONS, { googleSearch: {} }],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
      }));
    };

    this.ws.onmessage = async (event: MessageEvent) => {
      try {
        let text: string;
        if (event.data instanceof Blob) {
          text = await event.data.text();
        } else {
          text = event.data as string;
        }
        const msg = JSON.parse(text);
        this.handleMessage(msg);
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onerror = (ev) => {
      console.error("[GeminiLive] WebSocket error:", ev);
      this.handler({ type: "error", error: "WebSocket connection error" });
    };

    this.ws.onclose = (ev) => {
      console.log(`[GeminiLive] WebSocket closed: code=${ev.code} reason=${ev.reason}`);
      this.handler({ type: "closed" });
      this.ws = null;
      this.setupDone = false;
    };
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // Setup complete
    if ("setupComplete" in msg) {
      this.setupDone = true;
      this.handler({ type: "setupComplete" });
      return;
    }

    // Tool call from Gemini
    if ("toolCall" in msg) {
      const toolCall = msg.toolCall as {
        functionCalls?: Array<{ id: string; name: string; args?: Record<string, unknown> }>;
      };
      if (toolCall.functionCalls?.length) {
        const calls: GeminiToolCall[] = toolCall.functionCalls.map((fc) => ({
          id: fc.id,
          name: fc.name,
          args: fc.args || {},
        }));
        this.handler({ type: "toolCall", calls });
      }
      return;
    }

    // Server content
    if ("serverContent" in msg) {
      const content = msg.serverContent as Record<string, unknown>;

      // Output transcription (Gemini's speech as text)
      const outputT = content.outputTranscription as { text?: string } | undefined;
      if (outputT?.text) {
        this.handler({ type: "text", text: outputT.text });
      }

      // Input transcription (user's speech as text)
      const inputT = content.inputTranscription as { text?: string } | undefined;
      if (inputT?.text?.trim()) {
        this.handler({ type: "inputTranscript", text: inputT.text.trim() });
      }

      // Turn complete
      if (content.turnComplete) {
        this.handler({ type: "turnComplete" });
        return;
      }

      // Interrupted
      if (content.interrupted) {
        this.handler({ type: "interrupted" });
        return;
      }

      // Model turn parts (audio + text)
      const modelTurn = content.modelTurn as { parts?: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }> } | undefined;
      if (modelTurn?.parts) {
        for (const part of modelTurn.parts) {
          if (part.inlineData?.data) {
            const bytes = base64ToUint8Array(part.inlineData.data);
            this.handler({ type: "audio", data: bytes });
          }
          if (part.text) {
            this.handler({ type: "text", text: part.text });
          }
        }
      }
    }
  }

  /** Send function call results back to Gemini */
  sendToolResponse(responses: Array<{ id: string; name: string; response: unknown }>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupDone) return;

    this.ws.send(JSON.stringify({
      toolResponse: {
        functionResponses: responses.map((r) => ({
          id: r.id,
          name: r.name,
          response: r.response,
        })),
      },
    }));
  }

  /** Send base64-encoded PCM audio data to Gemini */
  sendAudio(base64Data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupDone) return;

    this.ws.send(JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: base64Data,
        },
      },
    }));
  }

  /** Send an image (base64, no data: prefix) to Gemini for visual context */
  sendImage(base64Data: string, mimeType: string = "image/jpeg"): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupDone) return;

    this.ws.send(JSON.stringify({
      realtimeInput: {
        media: {
          mimeType,
          data: base64Data,
        },
      },
    }));
  }

  /** Check if connected and setup is complete */
  get isReady(): boolean {
    return this.setupDone && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Disconnect */
  disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null; // prevent closed event
      this.ws.close();
      this.ws = null;
    }
    this.setupDone = false;
  }
}

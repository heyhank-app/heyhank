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

export interface PhoneContact {
  name: string;
  phone: string;
  notes?: string;
}

function buildSystemPrompt(assistantName: string, agents: AgentInfo[], recentConversations?: ConversationContext[], activeSessions?: ActiveSession[], userName?: string, contacts?: PhoneContact[]): string {
  const nameIntro = assistantName
    ? `You are "${assistantName}", a personal voice assistant on the HeyHank platform.`
    : `You are a personal voice assistant on the HeyHank platform.`;
  const userIntro = userName ? `\nThe user's name is ${userName}. Address them by name when appropriate.` : "";

  const agentSection = agents.length > 0
    ? `\nAGENTS (configured on the platform):
The following agents are available. You are the orchestrator — when the user assigns a task,
choose the appropriate agent and start it with run_agent (NOT create_session!).
run_agent uses the full agent profile with the correct model, prompt and permissions.

${agents.map((a) => `- "${a.name}" (${a.backend}): ${a.description}`).join("\n")}

When the user mentions an agent name (even approximately, e.g. "Max 2.0" for "Agent Max 2.0"),
recognize it and start the appropriate session. Only ask if it is truly unclear.`
    : "";

  return `${nameIntro}${userIntro}
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
- read_email: read an email (by UID). ALWAYS read the body out loud. Summarize if long.
- search_emails: search emails
- send_email: send a NEW email (needs: account, to, subject, body)
- reply_email: reply to an email (needs: account, uid of original email, body text)
- email_summary: unread emails across all accounts
IMPORTANT email rules:
- When reading emails, speak the content (from, subject, body) out loud.
- When replying, confirm with the user what to say, then call reply_email with the uid of the original email.
- When sending, ask for recipient, subject, and body if not provided.
- Always confirm before actually sending: "Shall I send this?"
- Use the first available email account if the user doesn't specify one.

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
- make_call: Place a real phone call via SIP trunk. The AI conducts the conversation autonomously.
  IMPORTANT: You can ONLY call saved contacts by name. You cannot call arbitrary phone numbers.
  Example: "Call Mama" → make_call("Mama", "Say hi and ask how she's doing")
  Example: "Call Restaurant Steirereck" → make_call("Restaurant Steirereck", "Reserve a table for 4 at 7pm Friday")
  If the user provides a phone number that's not a saved contact, ask them to save it first in Settings → Telephony → Contacts.
  You can optionally pass listen=true to let the user hear the call live through their speakers.
  Example: "Call Mama and let me listen" → make_call("Mama", "...", listen=true)
- list_active_calls: Show current active phone calls
- end_active_call: Hang up an active call
After starting a call, inform the user about the status. The call runs autonomously — you don't need to monitor it.${contacts && contacts.length > 0 ? `

PHONE CONTACTS (you may call these by name):
${contacts.map((c) => `- "${c.name}": ${c.phone}${c.notes ? ` (${c.notes})` : ""}`).join("\n")}` : ""}

SOCIAL MEDIA:
- prepare_social_post: Prepare a social media post as a DRAFT. The user can review and publish it from the Social Media page.
- create_social_post: Create and IMMEDIATELY publish a post (use only when user explicitly says to post now)
- list_social_posts: List recent social media posts (optional: filter by status)
- get_social_analytics: Get analytics/metrics for a social media profile
- reply_to_social_comment: Reply to a comment on a social media post

IMAGE UPLOADS:
When the user uploads an image, you will:
1. SEE the image (it's sent to you visually)
2. Receive a text message like "[Image uploaded and available at: /api/media/file/upload_xxx.jpg]"
You can use this URL directly in prepare_social_post as mediaUrls or thumbnailUrl.

IMPORTANT — ALWAYS ASK BEFORE CREATING A POST:
When the user asks to create a social media post, ALWAYS ask:
"Soll ich den Post selbst erstellen oder einen Agent beauftragen?
Selbst: Ich erstelle den Draft sofort.
Agent: Ein Agent kann zusätzlich Bilder generieren, recherchieren und den Text für jede Plattform optimieren."
- If user says "selbst" / "du" / "mach du" → use prepare_social_post
- If user says "agent" / "beauftrage" / "agent soll das machen" → use run_agent with the instructions below

AFTER CREATING A DRAFT (prepare_social_post response received):
Always tell the user the draft is ready and ask the complete workflow:
1. Read back the post text briefly
2. Ask: "Auf welchen Plattformen soll ich posten?" (if not already specified)
3. Ask: "Wann soll der Post veröffentlicht werden? Sofort, oder soll ich einen Termin setzen?"
4. If user gives a time → update the draft with scheduledAt
5. If user says "poste jetzt" → publish the draft immediately using create_social_post
6. If user wants to review first → tell them "Der Draft ist in der Social Media Seite unter Drafts, du kannst ihn dort bearbeiten und veröffentlichen."

Agent task instructions (include these when delegating):
- Generate images: POST /api/media/generate-image {prompt, model?, aspectRatio?} → {images: [{filename, path}]}
  Models: imagen-4.0-fast-generate-001 (default), imagen-4.0-generate-001, imagen-4.0-ultra-generate-001
- Generate videos: POST /api/media/generate-video {prompt, model?, aspectRatio?, durationSeconds?} → {operationName}
  Model: veo-3.1-fast-generate-preview. Poll: GET /api/media/video-status/{operationName}
- Files served at: /api/media/file/{filename}
- Create draft: POST /api/socialmedia/posts {text, platforms, isDraft: true, createdBy: "agent", mediaUrls?, videoUrl?, thumbnailUrl?, title?, firstComment?}
- Media URLs in draft: /api/media/file/{filename}
- After agent creates draft, monitor it and inform the user, then ask about platforms and timing as described above.

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
      description: "Place a real phone call to a SAVED CONTACT. An AI assistant will conduct the conversation autonomously. You MUST use a contact name — arbitrary phone numbers are NOT allowed for safety.",
      parameters: {
        type: "OBJECT",
        properties: {
          phone: {
            type: "STRING",
            description: "Contact name (e.g. 'Mama', 'Restaurant Steirereck'). Must be a saved contact in Settings → Telephony → Contacts.",
          },
          task: {
            type: "STRING",
            description: "The task/instruction for the AI on the call. Be specific about what to say and achieve.",
          },
          voice: {
            type: "STRING",
            description: "Voice for the call AI. Default: same as current voice.",
          },
          listen: {
            type: "BOOLEAN",
            description: "If true, stream live call audio to the user's browser so they can listen in real-time.",
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
    // ─── Social Media ──────────────────────────────────────────────
    {
      name: "prepare_social_post",
      description: "Prepare a social media post as a draft for user review. The post will appear in the Social Media page where the user can edit, schedule, and publish it.",
      parameters: {
        type: "OBJECT",
        properties: {
          text: {
            type: "STRING",
            description: "The post text/content.",
          },
          platforms: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Target platforms, e.g. [\"twitter\", \"linkedin\"].",
          },
          title: {
            type: "STRING",
            description: "Optional title/headline for the post.",
          },
          firstComment: {
            type: "STRING",
            description: "Optional text for the first comment (common on Instagram/LinkedIn).",
          },
          mediaUrls: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Optional image URLs to attach.",
          },
          videoUrl: {
            type: "STRING",
            description: "Optional video URL.",
          },
          thumbnailUrl: {
            type: "STRING",
            description: "Optional thumbnail/preview image URL.",
          },
          scheduledAt: {
            type: "STRING",
            description: "Optional ISO 8601 datetime to schedule the post.",
          },
        },
        required: ["text", "platforms"],
      },
    },
    {
      name: "create_social_post",
      description: "Create and publish a social media post on one or more platforms.",
      parameters: {
        type: "OBJECT",
        properties: {
          text: {
            type: "STRING",
            description: "The post text/content.",
          },
          platforms: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Platforms to post to, e.g. [\"twitter\", \"linkedin\"].",
          },
          scheduledAt: {
            type: "STRING",
            description: "Optional ISO 8601 datetime to schedule the post for later.",
          },
        },
        required: ["text", "platforms"],
      },
    },
    {
      name: "list_social_posts",
      description: "List recent social media posts. Optionally filter by status.",
      parameters: {
        type: "OBJECT",
        properties: {
          limit: {
            type: "INTEGER",
            description: "Max number of posts to return.",
          },
          status: {
            type: "STRING",
            description: "Filter by status: published, scheduled, failed.",
          },
        },
      },
    },
    {
      name: "get_social_analytics",
      description: "Get analytics/metrics for a social media profile.",
      parameters: {
        type: "OBJECT",
        properties: {
          profileId: {
            type: "STRING",
            description: "Profile/platform identifier.",
          },
        },
        required: ["profileId"],
      },
    },
    {
      name: "reply_to_social_comment",
      description: "Reply to a comment on a social media post.",
      parameters: {
        type: "OBJECT",
        properties: {
          postId: {
            type: "STRING",
            description: "The post ID.",
          },
          commentId: {
            type: "STRING",
            description: "The comment ID to reply to (optional for new comment).",
          },
          text: {
            type: "STRING",
            description: "Reply text.",
          },
        },
        required: ["postId", "text"],
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
  /** Previous conversation to resume (sent as context after setup) */
  private resumeHistory: Array<{ role: string; text: string }> | null = null;

  connect(apiKey: string, voice: string = "Kore", config?: { assistantName?: string; userName?: string; agents?: AgentInfo[]; recentConversations?: ConversationContext[]; activeSessions?: ActiveSession[]; contacts?: PhoneContact[]; resumeHistory?: Array<{ role: string; text: string }> }): void {
    this.resumeHistory = config?.resumeHistory || null;
    const url = `${WS_BASE}?key=${apiKey}`;
    this.ws = new WebSocket(url);

    const systemPrompt = buildSystemPrompt(
      config?.assistantName || "",
      config?.agents || [],
      config?.recentConversations,
      config?.activeSessions,
      config?.userName,
      config?.contacts,
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
      // If resuming a conversation, send previous turns as context
      if (this.resumeHistory && this.resumeHistory.length > 0 && this.ws) {
        const turns = this.resumeHistory.map((m) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.text }],
        }));
        this.ws.send(JSON.stringify({
          clientContent: { turns, turnComplete: true },
        }));
        this.resumeHistory = null;
      }
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

  /** Send a text message to Gemini (as user turn) */
  sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupDone) return;

    this.ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
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

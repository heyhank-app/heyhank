// ─── Hank Tools ─────────────────────────────────────────────────────────────
// Shared tool declarations + system prompt for all Hank-UI providers.
// Extracted from gemini-live-client.ts to be used server-side by all providers.

// ─── Interfaces ─────────────────────────────────────────────────────────────
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  backend: string;
}

export interface ConversationContext {
  title: string;
  content: string;
}

export interface ActiveSession {
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

// ─── System Prompt Builder ──────────────────────────────────────────────────
import { listProfiles as listStyleProfiles } from "./socialview/style-profiles.js";
import { listInstalledSkills } from "./skill-discovery.js";

export function buildSystemPrompt(assistantName: string, agents: AgentInfo[], recentConversations?: ConversationContext[], activeSessions?: ActiveSession[], userName?: string, contacts?: PhoneContact[], obsidianVaultPath?: string): string {
  // Snapshot of installed Claude Code skills under ~/.claude/skills/. Hank
  // can invoke any of these directly via the `run_skill` tool to handle
  // multi-turn structured workflows (content plans, post writing, audits…)
  // without delegating to a fire-and-forget agent run.
  let skillsSection = "";
  try {
    const skills = listInstalledSkills().filter((s) => s.description);
    if (skills.length > 0) {
      const lines = skills.map((s) => "- " + s.slug + ": " + s.description).join("\n");
      skillsSection = "\nINSTALLED SKILLS (invoke via `run_skill`):\n"
        + "Skills are structured multi-stage workflows. PREFER calling `run_skill(slug)`\n"
        + "over delegating to an agent when the user's request matches a skill's\n"
        + "description — the skill produces a high-quality result and you can guide the\n"
        + "user through it in this chat (multi-turn). After loading a skill, follow the\n"
        + "skill's own instructions: ask any inputs it needs, run its stages, present\n"
        + "its output. Use agents only for fire-and-forget async work that does not fit\n"
        + "a skill.\n\n" + lines;
    }
  } catch {
    // Skill discovery is best-effort.
  }
  // Snapshot of available style personas (loaded from ~/.heyhank/socialview/style-profiles).
  // Hank only needs to know which handles exist so he can map a user-spoken name
  // (e.g. "Rene Remsik") to the canonical handle for `generate_content`'s
  // styleProfileHandle param. The actual style is consumed downstream by the
  // content agent; Hank stays at the routing layer.
  let personasSection = "";
  try {
    const profiles = listStyleProfiles();
    if (profiles.length > 0) {
      personasSection = `\nSTYLE PERSONAS (available for generate_content's \`styleProfileHandle\` param):
The following personas have been distilled from extracted social posts. When the user
asks for content "im Stil von X" / "wie X schreibt", map their name to the handle below
and pass it as \`styleProfileHandle\`. If unsure, ask. Never invent a handle that isn't listed.

${profiles.map((p) => {
  const name = p.displayName && p.displayName !== p.handle ? ` — ${p.displayName}` : "";
  return `- ${p.handle} (${p.platform}${name})`;
}).join("\n")}`;
    }
  } catch {
    // Reading personas is best-effort — never break Hank if storage is missing.
  }

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
${skillsSection}

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

DELEGATIONS (tasks assigned to others):
- delegate_task: create a task delegated to someone (e.g. "Ask Peter to review the contract")
- list_delegations: show all delegated tasks, optionally filtered by person
When the user says "Peter soll..." or "delegate to...", use delegate_task.
When they ask "what did I delegate?" or "what's Peter working on?", use list_delegations.

PROJECTS (group related todos):
- list_projects: show all projects with progress (total/done/open)
- create_project: create a new project with optional initial todos
When the user says "create a project for..." or "start project...", use create_project.
When they ask "how are my projects?" or "project overview", use list_projects.

NOTES (memory):
- search_notes: search notes ("what do you know about X?")
- add_note: save a note ("remember that...", "note that...")
- update_note / delete_note: manage notes

MEMORY (long-term user preferences — IMPORTANT):
- save_memory: Remember a fact about the user. ALWAYS call this proactively.
- search_memory: Find relevant memories about the user.
- list_memories: List all known user facts.
- delete_memory: Forget something about the user.
When the user says "Merke dir dass...", "Remember that...", save it as a memory.
When the user says "Vergiss dass...", "Forget that...", delete the relevant memory.
CRITICAL: You MUST call save_memory whenever the user reveals ANY personal fact, preference, or detail about themselves. Examples:
- Name, location, timezone, language preferences
- Dietary preferences, allergies, health info
- Work schedule, job role, company
- Technical preferences (languages, frameworks, tools, OS)
- Family members, pets, hobbies
- Recurring habits or routines
Do NOT ask "should I remember this?" — just save it silently alongside your response.
Do NOT save transient requests, questions, or conversational filler.

CONTACTS/CRM:
- list_contacts: list all contacts (optional search query)
- add_contact: add a new contact (name required, optional: company, email, phone, notes, tags)
- update_contact: update an existing contact by ID
- search_contacts: search contacts by name, company, email, phone or tags
- log_interaction: log an interaction with a contact (call, email, meeting, note)
Use contacts to track people, relationships and interaction history.

DECISION LOG:
- log_decision: record an important decision with context, alternatives and reasoning
- search_decisions: search past decisions
Use the decision log when the user makes or discusses important decisions ("we decided to...", "let's go with...").

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

DAILY BRIEFING:
- get_daily_briefing: Get a full overview of the day: emails, calendar, todos, delegations, projects
When the user asks things like "what's my day look like?", "Tagesüberblick", "briefing", "was steht an?",
"morning update", "daily summary", use get_daily_briefing.

MEETING NOTES:
- create_meeting_notes: Create meeting notes with summary, participants, and action items
After a call or meeting ends, offer to create meeting notes. Extract key points and action items.
When the user says "save meeting notes", "note from the meeting", "Besprechungsnotiz", use create_meeting_notes.

Use the tools proactively. If the user says "I still need to do X", add it as a todo.
If they say "don't forget" or "remember that", save a note.
If they mention a time, set a reminder.
If they ask about emails, use email_summary for an overview or list_emails for details.
If they ask about events ("what's on today?", "do I have anything tomorrow?"), use calendar_summary or list_events.
If they want to create an event ("schedule a...", "meeting on..."), use create_event.
If the user assigns a complex task (create a website, write code, etc.), delegate to the appropriate agent.

TEAM COORDINATION:
- run_team: For complex tasks that need multiple agents working in parallel. A Team Coordinator will break the goal into tasks, assign agents (or create new ones), manage git worktrees for isolation, and merge results.
  Use this when the user asks for something complex that would benefit from multiple agents: "build a landing page", "implement 5 features", "refactor the entire module".
  After starting a team, use monitor_team periodically to check progress.
- monitor_team: Check team progress. Call this after run_team to track status.
  IMPORTANT: After every run_team you MUST call monitor_team to check progress!

TELEPHONY (phone calls):
- make_call: Place a real phone call via SIP trunk. The AI conducts the conversation autonomously.
  IMPORTANT: You can ONLY call saved contacts by name. You cannot call arbitrary phone numbers.
  Example: "Call Mama" → make_call("Mama", "Say hi and ask how she's doing")
  Example: "Call Restaurant Steirereck" → make_call("Restaurant Steirereck", "Reserve a table for 4 at 7pm Friday")
  If the user provides a phone number that's not a saved contact, ask them to save it first in Settings → Telephony → Contacts.
  You can optionally pass listen=true to let the user hear the call live through their speakers.
  Example: "Call Mama and let me listen" → make_call("Mama", "...", listen=true)
  By default the ad-hoc task takes priority. If the user explicitly says something like "run the saved script" / "nutze das gespeicherte Script", pass useSavedScript=true to inject the stored call script as primary objective.
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
- publish_draft: Publish an existing draft post (changes status from draft to published)
- update_draft: Update a draft post's text, platforms, or schedule
- delete_draft: Delete a draft post permanently
- schedule_post: Schedule an existing draft for a specific time

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
- If user says "agent" / "beauftrage" / "ein agent" / "agent soll das machen" / "content agent" → You MUST call the run_agent function immediately. Call run_agent with agent="Content Agent" and task="<detailed task with ALL context>". This is a FUNCTION CALL, not a text response. Do NOT just say you will start an agent — actually invoke the run_agent tool. Do NOT ask further questions like "which agent?" — just call the function right away. Include ALL context from the conversation in the task description so the agent has everything it needs.

CRITICAL TOOL CALLING RULE: When an action requires a tool (like run_agent, prepare_social_post, save_memory, etc.), you MUST actually call the function — do NOT just describe what you would do in text. Text responses about tools are USELESS. The user needs you to EXECUTE the function call.

AFTER CREATING A DRAFT (prepare_social_post response received):
Always tell the user the draft is ready and ask the complete workflow:
1. Read back the post text briefly
2. Ask: "Auf welchen Plattformen soll ich posten?" (if not already specified)
3. Ask: "Wann soll der Post veröffentlicht werden? Sofort, oder soll ich einen Termin setzen?"
4. If user gives a time → update the draft with scheduledAt
5. If user says "poste jetzt" → publish the draft immediately using create_social_post
6. If user wants to review first → tell them "Der Draft ist in der Social Media Seite unter Drafts, du kannst ihn dort bearbeiten und veröffentlichen."

Agent task instructions (include these when delegating):
- TWO image models available:
  1. Nano Banana 2 (PREFERRED for social media) — model: gemini-3.1-flash-image-preview via Gemini API. Can render TEXT IN IMAGES reliably (94% accuracy). Use for text overlays, quote graphics, carousels.
  2. Imagen 4 — POST /api/media/generate-image {prompt, aspectRatio?} → {images: [{filename, path}]}. Best photorealism. Supported aspectRatios: 1:1, 9:16, 16:9, 4:3, 3:4 (NO 4:5!).
- Generate videos: POST /api/media/generate-video {prompt, aspectRatio?, durationSeconds?} → {operationName}
  Veo 3.1: native audio, up to 60s+, 720p/1080p. Poll: GET /api/media/video-status/{operationName}
- Files served at: /api/media/file/{filename}
- Create draft: POST /api/socialmedia/posts {text, platforms, isDraft: true, createdBy: "agent", mediaUrls?, videoUrl?, thumbnailUrl?, title?, firstComment?}
- Media URLs in draft: /api/media/file/{filename}
- Platform image aspect ratios: Instagram/Facebook 3:4 (Portrait), LinkedIn 1:1 (Square), X/YouTube 16:9
- firstComment: Use for links (LinkedIn, Facebook penalize external links in post text) and CTAs (Instagram)
- IMPORTANT: Use python3 urllib for JSON payloads with special chars (not curl -d) to avoid JSON parse errors
- HASHTAG POOLS: Curated hashtag sets per business are stored at GET /api/socialmedia/hashtag-pools. The Content Agent automatically fetches these before creating posts. Pools contain popular/medium/niche/branded/blocked tiers.
- WORKFLOW: Generate image → create draft with mediaUrls → inform user
- CRITICAL: After run_agent returns with status "completed": The agent is ALREADY DONE. Do NOT repeat what you said before. Do NOT say "gestartet", "erstellt jetzt", "arbeitet noch", or describe the task again. The user already saw "Content Agent ist fertig!" — just confirm briefly:
  GOOD: "Fertig! Die Drafts sind bereit zur Freigabe."
  BAD: "Ich habe den Content Agent gestartet. Er erstellt jetzt die Posts und generiert Bilder."
  Keep it SHORT — one sentence max. Do NOT describe what the agent did.
- If run_agent returns "still_running": Say "Der Agent arbeitet noch — du kannst den Fortschritt auf der Agents-Seite verfolgen."

DOCUMENTS & FILES:
- list_documents: List all documents, optionally filtered by folder or tag.
- upload_document: Upload/create a new document (title, content, fileType, folder, tags).
- get_document: Retrieve a document's content and metadata by ID.
- search_documents: Full-text search across document titles, tags, folders, and summaries.
- delete_document: Delete a document.
Use these when the user says "save this document", "find the contract", "list my files", etc.

TEMPLATES:
- list_templates: List templates, optionally filtered by category (email, contract, meeting, invoice, report, custom).
- create_template: Create a reusable template with {{variable}} placeholders.
- use_template: Fill a template with variable values and return the result.
- search_templates: Search templates by name, category, or content.
- delete_template: Delete a template.
Use when the user says "create a template for...", "use the invoice template", "fill out the email template with...", etc.

NEWS & MONITORING:
- add_news_source: Add a new monitoring source (RSS feed, website, or keyword monitoring).
- list_news_sources: List all configured news sources.
- list_news: List latest news items, filterable by category, unread only, or saved only.
- search_news: Search news by keyword.
- mark_news_read: Mark a news item as read.
- get_news_stats: Get overview stats (total, unread, by category).
Use when the user says "monitor competitor X", "add RSS feed", "what's new?", "show me news about...", etc.

TIME TRACKING:
- start_timer: Start a timer for a task (with optional project/category).
- stop_timer: Stop the active timer.
- log_time: Manually log time (task, duration in minutes, project, notes).
- get_time_report: Get a time report for a period (today, week, month).
- get_active_timer: Check if a timer is currently running.
Use when the user says "start timer for...", "I worked 2 hours on...", "how much time this week?", "stop timer", etc.

FINANCE & INVOICES:
- create_invoice: Create a new invoice (client, items with description/quantity/unitPrice/total).
- list_invoices: List invoices, filtered by status (draft, sent, paid, overdue).
- mark_invoice_paid: Mark an invoice as paid.
- log_expense: Log a business expense (description, amount, category).
- list_expenses: List expenses, filtered by category or date range.
- get_financial_summary: Get financial overview (revenue, expenses, profit) for a period.
Use when the user says "create invoice for...", "log expense...", "how much revenue this month?", "outstanding invoices?", etc.

KPI DASHBOARD:
- define_kpi: Define a new KPI metric (name, unit, category, target, direction up/down).
- record_kpi_value: Record a new value for a KPI.
- get_kpi_dashboard: Get the full KPI dashboard with all metrics and status.
- get_kpi_history: Get historical values for a KPI over a period.
- delete_kpi: Delete a KPI metric.
Use when the user says "define a KPI for...", "update my revenue KPI", "show KPI dashboard", "how are my metrics?", etc.

CONTENT ENGINE (website analysis & content generation):
These tools require a WEBSITE URL — only use them when the user provides or
clearly references a specific website / company / product to analyze. For a
generic content plan around a niche or topic (no specific website), prefer
the content-30day-plan skill via run_skill instead.

- analyze_website: Crawl a website and extract brand identity, business type, products/services, colors, images, and tone of voice. Use when user says "analyze this website", "check out this URL", etc.
- create_content_strategy: Create a content marketing strategy based on website analysis. Includes content pillars, pain points, posting schedules, and customer journey mapping.
- generate_content: Generate platform-optimized content pieces with hooks, copywriting frameworks (PAS, AIDA, BAB, StoryBrand), hashtags, and image prompts.
- generate_ad_creatives: Generate ad creatives with copy, image prompts, and brand-aligned design specs for a specific platform.
- generate_ads: FULL AD WORKFLOW — Analyzes website, generates ad copy, creates images, and saves everything as Social Media drafts. One call does everything. Use this when the user wants actual ad drafts with images (not just copy).
- generate_content_plan: Generate a complete multi-week content plan across platforms. Combines strategy + content + ads into one comprehensive plan.
Use these tools when the user wants to:
- Analyze a website or competitor
- Create a content strategy from a specific website
- Generate social media content based on a business website
- Create ad campaigns
- Plan content calendars FROM A SPECIFIC WEBSITE
Do NOT ask for a URL when the user just wants ideas/posts for a topic or niche
without referencing a specific website — use a skill instead.

${personasSection}

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
Use this knowledge to maintain context.` : ""}${obsidianVaultPath ? `

OBSIDIAN VAULT (Knowledge Base):
All your data is stored as Markdown files in the Obsidian vault at: ${obsidianVaultPath}/HeyHank/
- Memory/ — Long-term facts about the user (auto-synced with your memory tools)
- Notes/ — User's notes (synced with add_note/search_notes)
- Todos/ — Task list (synced with add_todo/list_todos)
- Reminders/ — Reminders (synced with add_reminder/list_reminders)
- Conversations/ — Past chat conversations (auto-saved)
- Calls/ — Phone call transcripts (auto-saved)
When you save a memory, note, or todo, it is automatically stored as a .md file in the vault.
The user can also edit these files directly in Obsidian — changes sync back automatically.
If the user asks "where is this saved?" or "where can I find my notes?", tell them about the vault location.` : ""}`;
}

// ─── Gemini Tool Declarations ───────────────────────────────────────────────
const TOOL_DECLARATIONS = [{
  functionDeclarations: [
    {
      name: "run_skill",
      description: "Load a Claude Code skill from ~/.claude/skills/<slug>/SKILL.md and follow its instructions in the current chat. Use this for structured multi-stage workflows (content plans, post writing, audits, code review etc.) — the skill output is returned to you, and you continue the workflow with the user (multi-turn). PREFER this over run_agent when the request matches a skill's description and benefits from interactive back-and-forth.",
      parameters: {
        type: "OBJECT",
        properties: {
          slug: {
            type: "STRING",
            description: "Skill slug (the directory name under ~/.claude/skills/, e.g. 'content-30day-plan').",
          },
          input: {
            type: "STRING",
            description: "Optional initial input/context the skill should start with (e.g. niche, topic, file path).",
          },
        },
        required: ["slug"],
      },
    },
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
    // ─── Delegation Tools ────────────────────────────────────────────
    {
      name: "delegate_task",
      description: "Create a task delegated to another person. Use when the user says 'delegate to...', 'ask X to do...' or 'X soll...'.",
      parameters: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING", description: "The task description." },
          delegatedTo: { type: "STRING", description: "Name of the person to delegate to." },
          dueDate: { type: "STRING", description: "Due date in ISO format YYYY-MM-DD." },
          priority: { type: "STRING", description: "Priority level.", enum: ["high", "medium", "low"] },
          category: { type: "STRING", description: "Optional category." },
          project: { type: "STRING", description: "Optional project name." },
        },
        required: ["text", "delegatedTo"],
      },
    },
    {
      name: "list_delegations",
      description: "List all tasks delegated to others. Optionally filter by person name.",
      parameters: {
        type: "OBJECT",
        properties: {
          person: { type: "STRING", description: "Filter by person name (optional)." },
        },
      },
    },
    // ─── Project Tools ──────────────────────────────────────────────
    {
      name: "list_projects",
      description: "List all projects with progress. Groups todos by project field and shows total/done/open count.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "create_project",
      description: "Create a new project. Creates a project note and optionally initial todos assigned to the project.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Project name." },
          description: { type: "STRING", description: "Project description." },
          todos: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Optional list of initial todo texts for the project.",
          },
        },
        required: ["name"],
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
          useSavedScript: {
            type: "BOOLEAN",
            description: "If true, the saved call-script for this contact (if any) is injected as PRIMARY OBJECTIVE. Default false — the ad-hoc task takes priority. Only set true when the user explicitly wants the saved script to run.",
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
    {
      name: "publish_draft",
      description: "Publish an existing draft post. Changes status from draft to published.",
      parameters: {
        type: "OBJECT",
        properties: {
          postId: {
            type: "STRING",
            description: "The draft post ID to publish.",
          },
        },
        required: ["postId"],
      },
    },
    {
      name: "update_draft",
      description: "Update an existing draft post's text, platforms, or schedule.",
      parameters: {
        type: "OBJECT",
        properties: {
          postId: {
            type: "STRING",
            description: "The draft post ID to update.",
          },
          text: {
            type: "STRING",
            description: "New post text.",
          },
          platforms: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "New target platforms.",
          },
          scheduledAt: {
            type: "STRING",
            description: "New schedule time (ISO 8601) or empty to unschedule.",
          },
        },
        required: ["postId"],
      },
    },
    {
      name: "delete_draft",
      description: "Delete a draft post permanently.",
      parameters: {
        type: "OBJECT",
        properties: {
          postId: {
            type: "STRING",
            description: "The draft post ID to delete.",
          },
        },
        required: ["postId"],
      },
    },
    {
      name: "schedule_post",
      description: "Schedule an existing draft post for a specific time.",
      parameters: {
        type: "OBJECT",
        properties: {
          postId: {
            type: "STRING",
            description: "The draft post ID to schedule.",
          },
          scheduledAt: {
            type: "STRING",
            description: "ISO 8601 datetime to publish the post.",
          },
        },
        required: ["postId", "scheduledAt"],
      },
    },
    // ─── Team Coordination Tools ────────────────────────────────────
    {
      name: "run_team",
      description: "Start a coordinated team of agents working in parallel on a complex goal. The Team Coordinator will break the goal into tasks, create isolated worktrees, assign agents, monitor progress, and merge results. Use this for multi-part tasks that benefit from parallel work by multiple agents.",
      parameters: {
        type: "OBJECT",
        properties: {
          goal: {
            type: "STRING",
            description: "The goal to achieve. Be specific.",
          },
          cwd: {
            type: "STRING",
            description: "Project directory (must be a git repo).",
          },
          agents: {
            type: "STRING",
            description: "Optional comma-separated agent names to use.",
          },
        },
        required: ["goal", "cwd"],
      },
    },
    {
      name: "monitor_team",
      description: "Check the status of a running team. Shows which agents are working, done, or failed.",
      parameters: {
        type: "OBJECT",
        properties: {
          team_id: {
            type: "STRING",
            description: "The team ID returned by run_team.",
          },
        },
        required: ["team_id"],
      },
    },
    {
      name: "fix_claude_auth",
      description: "Attempt to fix Claude Code authentication. Use when the user reports auth issues or when sessions fail with 401 errors.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    // ─── Memory Tools ──────────────────────────────────────────────────
    {
      name: "save_memory",
      description: "Save a fact, preference, or personal detail about the user. Use when the user shares personal information, preferences, or recurring facts. Examples: 'I'm vegetarian', 'My timezone is CET', 'I prefer dark mode'.",
      parameters: {
        type: "OBJECT",
        properties: {
          content: {
            type: "STRING",
            description: "The fact or preference to remember about the user.",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "search_memory",
      description: "Search user memories by topic. Use to recall facts about the user relevant to the current conversation.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Search query (e.g. 'food preferences', 'timezone', 'work schedule').",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "list_memories",
      description: "List all saved user memories.",
      parameters: {
        type: "OBJECT",
        properties: {},
      },
    },
    {
      name: "delete_memory",
      description: "Delete a user memory. Use when the user says 'forget that...' or 'don't remember...'.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: {
            type: "STRING",
            description: "The memory ID to delete. Use search_memory or list_memories first to find the ID.",
          },
        },
        required: ["id"],
      },
    },
    // ─── Contact Tools ──────────────────────────────────────────────────
    {
      name: "list_contacts",
      description: "List all contacts. Optionally search by name, company, email or tags.",
      parameters: {
        type: "OBJECT",
        properties: {
          search: {
            type: "STRING",
            description: "Optional search query to filter contacts.",
          },
        },
      },
    },
    {
      name: "add_contact",
      description: "Add a new contact to the CRM. Use when the user mentions a person they want to track.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Contact name (required)." },
          company: { type: "STRING", description: "Company or organization." },
          email: { type: "STRING", description: "Email address." },
          phone: { type: "STRING", description: "Phone number." },
          notes: { type: "STRING", description: "Notes about the contact." },
          tags: { type: "STRING", description: "Comma-separated tags for categorization." },
        },
        required: ["name"],
      },
    },
    {
      name: "update_contact",
      description: "Update an existing contact's information.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "The contact ID to update." },
          name: { type: "STRING", description: "New name." },
          company: { type: "STRING", description: "New company." },
          email: { type: "STRING", description: "New email." },
          phone: { type: "STRING", description: "New phone." },
          notes: { type: "STRING", description: "New notes." },
          tags: { type: "STRING", description: "Comma-separated tags." },
        },
        required: ["id"],
      },
    },
    {
      name: "search_contacts",
      description: "Search contacts by name, company, email, phone or tags.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Search query.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "log_interaction",
      description: "Log an interaction with a contact (call, email, meeting, note). Updates the contact's last contact date.",
      parameters: {
        type: "OBJECT",
        properties: {
          contactId: { type: "STRING", description: "The contact ID." },
          type: {
            type: "STRING",
            description: "Type of interaction.",
            enum: ["call", "email", "meeting", "note"],
          },
          summary: { type: "STRING", description: "Summary of the interaction." },
        },
        required: ["contactId", "type", "summary"],
      },
    },
    // ─── Decision Tools ─────────────────────────────────────────────────
    {
      name: "log_decision",
      description: "Record an important decision with context, alternatives considered, and reasoning. Use when the user makes or discusses a decision.",
      parameters: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "Short title for the decision." },
          context: { type: "STRING", description: "Background context / what prompted this decision." },
          decision: { type: "STRING", description: "What was decided." },
          alternatives: { type: "STRING", description: "Comma-separated list of alternatives that were considered." },
          reasoning: { type: "STRING", description: "Why this option was chosen." },
        },
        required: ["title", "context", "decision"],
      },
    },
    {
      name: "search_decisions",
      description: "Search past decisions by title, context, decision text or reasoning.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: {
            type: "STRING",
            description: "Search query.",
          },
        },
        required: ["query"],
      },
    },
    // ─── Daily Briefing ──────────────────────────────────────────────
    {
      name: "get_daily_briefing",
      description: "Get today's overview: emails, calendar, todos, delegations, projects. Use when the user asks for a daily briefing, morning update, or day overview.",
      parameters: {
        type: "OBJECT",
        properties: {
          date: {
            type: "STRING",
            description: "ISO date (YYYY-MM-DD) to get the briefing for. Defaults to today.",
          },
        },
      },
    },
    // ─── Meeting Notes ───────────────────────────────────────────────
    {
      name: "create_meeting_notes",
      description: "Create meeting notes with summary, participants, and action items. After a call or meeting ends, offer to create meeting notes.",
      parameters: {
        type: "OBJECT",
        properties: {
          title: {
            type: "STRING",
            description: "Meeting title.",
          },
          summary: {
            type: "STRING",
            description: "Summary of what was discussed.",
          },
          participants: {
            type: "STRING",
            description: "Comma-separated list of participant names.",
          },
          actionItems: {
            type: "STRING",
            description: "Comma-separated list of action items from the meeting.",
          },
          callId: {
            type: "STRING",
            description: "Optional telephony call ID to link to the meeting notes.",
          },
        },
        required: ["title", "summary"],
      },
    },
    // ─── Content Engine Tools ─────────────────────────────────────────
    {
      name: "analyze_website",
      description: "Analyze a website to extract brand identity, business type, products/services, colors, images, and tone of voice. Use when the user provides a URL and wants to understand a business or prepare content.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: {
            type: "STRING",
            description: "The website URL to analyze (e.g. 'https://example.com').",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "create_content_strategy",
      description: "Create a content marketing strategy based on website analysis. Includes content pillars, pain points, posting schedule, and journey mapping.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: {
            type: "STRING",
            description: "The website URL to base the strategy on.",
          },
          platforms: {
            type: "STRING",
            description: "Comma-separated list of target platforms. Default: 'instagram,linkedin,facebook'. Options: instagram, linkedin, facebook, tiktok, x, youtube.",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "generate_content",
      description: "Generate platform-optimized content pieces with hooks, copywriting frameworks, hashtags, and image prompts based on a website analysis.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: {
            type: "STRING",
            description: "The website URL to generate content for.",
          },
          platform: {
            type: "STRING",
            description: "Target platform: instagram, linkedin, facebook, tiktok, x, youtube.",
          },
          count: {
            type: "NUMBER",
            description: "Number of content pieces to generate. Default: 5.",
          },
          journeyStage: {
            type: "STRING",
            description: "Customer journey stage: 'attract' (awareness), 'convert' (consideration), or 'close' (decision). Default: all stages.",
          },
          styleProfileHandle: {
            type: "STRING",
            description: "Optional handle of a SocialView role-model (e.g. 'rene.remsik') whose saved StyleProfile will drive the writing voice/structure. Use when the user asks for content 'im Stil von X' or 'wie X schreibt'. Profile must exist (created via SocialView style-profile analysis).",
          },
        },
        required: ["url", "platform"],
      },
    },
    {
      name: "generate_ad_creatives",
      description: "Generate ad creatives with copy, image prompts, and brand-aligned design specs for a specific platform.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: {
            type: "STRING",
            description: "The website URL to generate ads for.",
          },
          platform: {
            type: "STRING",
            description: "Target ad platform: instagram, linkedin, facebook, tiktok, x, youtube.",
          },
          count: {
            type: "NUMBER",
            description: "Number of ad creatives to generate. Default: 3.",
          },
        },
        required: ["url", "platform"],
      },
    },
    {
      name: "generate_ads",
      description: "Full ad creation workflow: Analyzes a website, generates ad copy, creates images with AI, and saves everything as Social Media drafts ready for review. Returns draft IDs and a link to review them.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: {
            type: "STRING",
            description: "The website URL to create ads for.",
          },
          platforms: {
            type: "STRING",
            description: "Comma-separated target platforms. Default: all connected profiles. Options: instagram, linkedin, facebook, twitter.",
          },
          count: {
            type: "NUMBER",
            description: "Number of ad variations per platform. Default: 2.",
          },
          style: {
            type: "STRING",
            description: "Visual style: 'professional' (clean, corporate), 'bold' (high contrast, attention-grabbing), 'minimal' (whitespace, elegant), 'playful' (colorful, casual). Default: 'professional'.",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "generate_content_plan",
      description: "Generate a complete content plan for multiple weeks. Includes strategy, content pieces, and scheduling across platforms.",
      parameters: {
        type: "OBJECT",
        properties: {
          url: {
            type: "STRING",
            description: "The website URL to base the plan on.",
          },
          platforms: {
            type: "STRING",
            description: "Comma-separated platforms. Default: 'instagram,linkedin,facebook'.",
          },
          weeks: {
            type: "NUMBER",
            description: "Number of weeks to plan for. Default: 4.",
          },
        },
        required: ["url"],
      },
    },
    // ─── Documents ────────────────────────────────────────────────────
    {
      name: "list_documents",
      description: "List documents, optionally filtered by folder or tag.",
      parameters: {
        type: "OBJECT",
        properties: {
          folder: { type: "STRING", description: "Filter by folder name." },
          tag: { type: "STRING", description: "Filter by tag." },
        },
      },
    },
    {
      name: "upload_document",
      description: "Upload/create a new document.",
      parameters: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", description: "Document title." },
          content: { type: "STRING", description: "Document content." },
          fileType: { type: "STRING", description: "File type (txt, md, pdf, etc.)." },
          folder: { type: "STRING", description: "Folder to store in. Default: 'General'." },
          tags: { type: "STRING", description: "Comma-separated tags." },
          summary: { type: "STRING", description: "AI-generated summary of the document." },
        },
        required: ["title", "content", "fileType"],
      },
    },
    {
      name: "get_document",
      description: "Get a document's content and metadata by ID.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "Document ID." },
        },
        required: ["id"],
      },
    },
    {
      name: "search_documents",
      description: "Search documents by keyword across titles, tags, folders, and summaries.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Search query." },
        },
        required: ["query"],
      },
    },
    {
      name: "delete_document",
      description: "Delete a document by ID.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "Document ID." },
        },
        required: ["id"],
      },
    },
    // ─── Templates ──────────────────────────────────────────────────
    {
      name: "list_templates",
      description: "List templates, optionally filtered by category.",
      parameters: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING", description: "Filter by category (email, contract, meeting, invoice, report, custom)." },
        },
      },
    },
    {
      name: "create_template",
      description: "Create a reusable template with {{variable}} placeholders.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Template name." },
          content: { type: "STRING", description: "Template content with {{variable}} placeholders." },
          category: { type: "STRING", description: "Category (email, contract, meeting, invoice, report, custom)." },
          tags: { type: "STRING", description: "Comma-separated tags." },
        },
        required: ["name", "content", "category"],
      },
    },
    {
      name: "use_template",
      description: "Fill a template with variable values and return the result.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "Template ID." },
          variables: { type: "STRING", description: "JSON object of variable name-value pairs, e.g. '{\"name\": \"John\", \"date\": \"2026-04-14\"}'." },
        },
        required: ["id", "variables"],
      },
    },
    {
      name: "search_templates",
      description: "Search templates by name, category, or content.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Search query." },
        },
        required: ["query"],
      },
    },
    {
      name: "delete_template",
      description: "Delete a template by ID.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "Template ID." },
        },
        required: ["id"],
      },
    },
    // ─── News & Monitoring ──────────────────────────────────────────
    {
      name: "add_news_source",
      description: "Add a monitoring source (RSS feed, website, or keyword monitoring).",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "Source name (e.g. 'TechCrunch', 'Competitor Blog')." },
          type: { type: "STRING", description: "Source type: rss, website, or keyword." },
          category: { type: "STRING", description: "Category (e.g. 'industry', 'competitor', 'technology')." },
          url: { type: "STRING", description: "URL for RSS or website type." },
          keywords: { type: "STRING", description: "Comma-separated keywords for keyword type." },
          checkInterval: { type: "NUMBER", description: "Check interval in minutes. Default: 60." },
        },
        required: ["name", "type", "category"],
      },
    },
    {
      name: "list_news_sources",
      description: "List all configured news monitoring sources.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "list_news",
      description: "List latest news items.",
      parameters: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING", description: "Filter by category." },
          unreadOnly: { type: "BOOLEAN", description: "Show only unread items." },
          limit: { type: "NUMBER", description: "Max items to return. Default: 20." },
        },
      },
    },
    {
      name: "search_news",
      description: "Search news items by keyword.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Search query." },
        },
        required: ["query"],
      },
    },
    {
      name: "mark_news_read",
      description: "Mark a news item as read.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "News item ID." },
        },
        required: ["id"],
      },
    },
    {
      name: "get_news_stats",
      description: "Get news overview: total items, unread count, by category.",
      parameters: { type: "OBJECT", properties: {} },
    },
    // ─── Time Tracking ──────────────────────────────────────────────
    {
      name: "start_timer",
      description: "Start a timer for a task.",
      parameters: {
        type: "OBJECT",
        properties: {
          task: { type: "STRING", description: "What you're working on." },
          project: { type: "STRING", description: "Project name." },
          category: { type: "STRING", description: "Category (e.g. development, meeting, admin)." },
        },
        required: ["task"],
      },
    },
    {
      name: "stop_timer",
      description: "Stop the currently running timer.",
      parameters: {
        type: "OBJECT",
        properties: {
          notes: { type: "STRING", description: "Optional notes about what was done." },
        },
      },
    },
    {
      name: "get_active_timer",
      description: "Check if a timer is currently running.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "log_time",
      description: "Manually log time spent on a task.",
      parameters: {
        type: "OBJECT",
        properties: {
          task: { type: "STRING", description: "What was worked on." },
          duration: { type: "NUMBER", description: "Duration in minutes." },
          project: { type: "STRING", description: "Project name." },
          category: { type: "STRING", description: "Category." },
          notes: { type: "STRING", description: "Notes." },
          date: { type: "STRING", description: "Date (ISO). Default: today." },
        },
        required: ["task", "duration"],
      },
    },
    {
      name: "get_time_report",
      description: "Get a time tracking report for a period.",
      parameters: {
        type: "OBJECT",
        properties: {
          period: { type: "STRING", description: "Period: today, week, month. Default: week." },
        },
      },
    },
    // ─── Finance & Invoices ─────────────────────────────────────────
    {
      name: "create_invoice",
      description: "Create a new invoice.",
      parameters: {
        type: "OBJECT",
        properties: {
          clientName: { type: "STRING", description: "Client/company name." },
          items: { type: "STRING", description: "JSON array of items, each with description, quantity, unitPrice, total. Example: '[{\"description\": \"Web Design\", \"quantity\": 1, \"unitPrice\": 2000, \"total\": 2000}]'" },
          clientEmail: { type: "STRING", description: "Client email." },
          taxRate: { type: "NUMBER", description: "Tax rate percentage. Default: from settings." },
          currency: { type: "STRING", description: "Currency code. Default: EUR." },
          dueDate: { type: "STRING", description: "Due date (YYYY-MM-DD). Default: 30 days." },
          notes: { type: "STRING", description: "Additional notes." },
        },
        required: ["clientName", "items"],
      },
    },
    {
      name: "list_invoices",
      description: "List invoices, filtered by status.",
      parameters: {
        type: "OBJECT",
        properties: {
          status: { type: "STRING", description: "Filter: draft, sent, paid, overdue, cancelled." },
        },
      },
    },
    {
      name: "mark_invoice_paid",
      description: "Mark an invoice as paid.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "Invoice ID." },
        },
        required: ["id"],
      },
    },
    {
      name: "log_expense",
      description: "Log a business expense.",
      parameters: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING", description: "What was purchased/paid." },
          amount: { type: "NUMBER", description: "Amount." },
          category: { type: "STRING", description: "Category (e.g. software, office, travel, marketing)." },
          vendor: { type: "STRING", description: "Vendor/company name." },
          project: { type: "STRING", description: "Associated project." },
          date: { type: "STRING", description: "Date (YYYY-MM-DD). Default: today." },
          notes: { type: "STRING", description: "Additional notes." },
        },
        required: ["description", "amount", "category"],
      },
    },
    {
      name: "list_expenses",
      description: "List expenses, filtered by category or date range.",
      parameters: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING", description: "Filter by category." },
          startDate: { type: "STRING", description: "Start date (YYYY-MM-DD)." },
          endDate: { type: "STRING", description: "End date (YYYY-MM-DD)." },
        },
      },
    },
    {
      name: "get_financial_summary",
      description: "Get financial overview: revenue, expenses, profit for a period.",
      parameters: {
        type: "OBJECT",
        properties: {
          period: { type: "STRING", description: "Period: month, quarter, year. Default: month." },
        },
      },
    },
    // ─── KPI Dashboard ──────────────────────────────────────────────
    {
      name: "define_kpi",
      description: "Define a new KPI metric to track.",
      parameters: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "KPI name (e.g. 'Monthly Revenue', 'Customer Satisfaction')." },
          unit: { type: "STRING", description: "Unit (%, EUR, count, hours, etc.)." },
          category: { type: "STRING", description: "Category (revenue, growth, operations, marketing, custom)." },
          target: { type: "NUMBER", description: "Target value." },
          direction: { type: "STRING", description: "Direction: 'up' (higher=better) or 'down' (lower=better). Default: up." },
          description: { type: "STRING", description: "Description of this KPI." },
        },
        required: ["name", "unit", "category"],
      },
    },
    {
      name: "record_kpi_value",
      description: "Record a new value for a KPI.",
      parameters: {
        type: "OBJECT",
        properties: {
          kpiId: { type: "STRING", description: "KPI ID." },
          value: { type: "NUMBER", description: "The value to record." },
          date: { type: "STRING", description: "Date (YYYY-MM-DD). Default: today." },
          note: { type: "STRING", description: "Optional note." },
        },
        required: ["kpiId", "value"],
      },
    },
    {
      name: "get_kpi_dashboard",
      description: "Get the full KPI dashboard with all metrics, trends, and status.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "get_kpi_history",
      description: "Get historical values for a specific KPI.",
      parameters: {
        type: "OBJECT",
        properties: {
          kpiId: { type: "STRING", description: "KPI ID." },
          period: { type: "STRING", description: "Period: week, month, quarter, year." },
        },
        required: ["kpiId"],
      },
    },
    {
      name: "delete_kpi",
      description: "Delete a KPI metric.",
      parameters: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "KPI ID." },
        },
        required: ["id"],
      },
    },
  ],
}];

// ─── Gemini Format Export ───────────────────────────────────────────────────
/** Returns tool declarations in Gemini format (functionDeclarations groups) */
export function getToolDeclarationsGemini() {
  return TOOL_DECLARATIONS;
}

// ─── OpenAI Format Converter ────────────────────────────────────────────────

/** Helper to convert Gemini schema types to OpenAI/JSON Schema types */
function convertGeminiSchemaToOpenAI(schema: any): any {
  if (!schema) return { type: "object", properties: {} };
  const result: any = {};
  // Convert type: "OBJECT" → "object", "STRING" → "string", "NUMBER" → "number", "BOOLEAN" → "boolean", "INTEGER" → "integer", "ARRAY" → "array"
  result.type = (schema.type || "object").toLowerCase();
  if (schema.properties) {
    result.properties = {};
    for (const [key, val] of Object.entries(schema.properties)) {
      result.properties[key] = convertGeminiSchemaToOpenAI(val);
    }
  }
  if (schema.required) result.required = schema.required;
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.items) result.items = convertGeminiSchemaToOpenAI(schema.items);
  return result;
}

/** Returns tool declarations in OpenAI function-calling format */
export function getToolDeclarationsOpenAI() {
  const geminiTools = getToolDeclarationsGemini();
  return geminiTools.flatMap(group =>
    group.functionDeclarations.map(fn => ({
      type: "function" as const,
      function: {
        name: fn.name,
        description: fn.description,
        parameters: convertGeminiSchemaToOpenAI(fn.parameters),
      },
    }))
  );
}

// ─── Utility ────────────────────────────────────────────────────────────────

/** Returns a flat list of all tool names */
export function getToolNames(): string[] {
  return getToolDeclarationsGemini().flatMap(g => g.functionDeclarations.map(f => f.name));
}

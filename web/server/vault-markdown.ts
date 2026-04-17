// ─── Vault Markdown Serialization ────────────────────────────────────────────
// Pure functions to convert HeyHank data models to/from Markdown with YAML frontmatter.
// Used by vault-store.ts for Obsidian-as-primary-store architecture.

import type { Todo, Note, Reminder, GeminiConversation, Contact, ContactInteraction, Decision } from "./assistant-store.js";

// ─── Frontmatter Parser ─────────────────────────────────────────────────────

export function parseFrontmatter(md: string): { frontmatter: Record<string, string>; body: string } {
  const match = md.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: md.trim() };
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(": ");
    if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 2).trim();
  }
  return { frontmatter: fm, body: match[2].trim() };
}

function buildFrontmatter(fields: Array<[string, string | undefined]>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of fields) {
    if (value !== undefined) lines.push(`${key}: ${value}`);
  }
  lines.push("---");
  return lines.join("\n");
}

// ─── Todos ───────────────────────────────────────────────────────────────────

export function todoToMarkdown(todo: Todo): string {
  const fm = buildFrontmatter([
    ["id", todo.id],
    ["priority", todo.priority],
    ["done", String(todo.done)],
    ["category", todo.category],
    ["delegatedTo", todo.delegatedTo],
    ["dueDate", todo.dueDate],
    ["followUpDate", todo.followUpDate],
    ["project", todo.project],
    ["createdAt", todo.createdAt],
    ["doneAt", todo.doneAt],
  ]);
  return `${fm}\n\n${todo.text}\n`;
}

export function markdownToTodo(md: string): Todo {
  const { frontmatter: fm, body } = parseFrontmatter(md);
  return {
    id: fm.id || "",
    text: body,
    priority: (["high", "medium", "low"].includes(fm.priority) ? fm.priority : "medium") as Todo["priority"],
    done: fm.done === "true",
    createdAt: fm.createdAt || "",
    doneAt: fm.doneAt || undefined,
    category: fm.category || undefined,
    delegatedTo: fm.delegatedTo || undefined,
    dueDate: fm.dueDate || undefined,
    followUpDate: fm.followUpDate || undefined,
    project: fm.project || undefined,
  };
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export function noteToMarkdown(note: Note): string {
  const fm = buildFrontmatter([
    ["id", note.id],
    ["createdAt", note.createdAt],
    ["updatedAt", note.updatedAt],
    ["tags", note.tags.length > 0 ? note.tags.join(", ") : undefined],
  ]);
  return `${fm}\n\n# ${note.title}\n\n${note.content}\n`;
}

export function markdownToNote(md: string): Note {
  const { frontmatter: fm, body } = parseFrontmatter(md);
  // Parse title from first heading, rest is content
  const titleMatch = body.match(/^# (.+)\n\n?([\s\S]*)$/);
  const title = titleMatch ? titleMatch[1].trim() : body.split("\n")[0];
  const content = titleMatch ? titleMatch[2].trim() : "";
  const tags = fm.tags ? fm.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  return {
    id: fm.id || "",
    title,
    content,
    tags,
    createdAt: fm.createdAt || "",
    updatedAt: fm.updatedAt || "",
  };
}

// ─── Reminders ───────────────────────────────────────────────────────────────

export function reminderToMarkdown(reminder: Reminder): string {
  const fm = buildFrontmatter([
    ["id", reminder.id],
    ["triggerAt", reminder.triggerAt],
    ["fired", String(reminder.fired)],
    ["createdAt", reminder.createdAt],
    ["calendarEventUid", reminder.calendarEventUid],
  ]);
  return `${fm}\n\n${reminder.text}\n`;
}

export function markdownToReminder(md: string): Reminder {
  const { frontmatter: fm, body } = parseFrontmatter(md);
  const reminder: Reminder = {
    id: fm.id || "",
    text: body,
    triggerAt: fm.triggerAt || "",
    fired: fm.fired === "true",
    createdAt: fm.createdAt || "",
  };
  if (fm.calendarEventUid) reminder.calendarEventUid = fm.calendarEventUid;
  return reminder;
}

// ─── Conversations ───────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  user: "You",
  gemini: "Hank",
  system: "System",
};

export function conversationToMarkdown(convo: GeminiConversation): string {
  const fm = buildFrontmatter([
    ["id", convo.id],
    ["title", convo.title],
    ["createdAt", convo.createdAt],
    ["duration", convo.duration !== undefined ? String(convo.duration) : undefined],
  ]);
  const msgLines = convo.messages.map((m) => {
    const label = ROLE_LABELS[m.role] || m.role;
    return `**${label}**: ${m.text}`;
  });
  return `${fm}\n\n${msgLines.join("\n\n")}\n`;
}

export function markdownToConversation(md: string): GeminiConversation {
  const { frontmatter: fm, body } = parseFrontmatter(md);
  // Parse messages from body: **Label**: text
  const messages: Array<{ role: "user" | "gemini" | "system"; text: string; ts: number }> = [];
  const labelToRole: Record<string, "user" | "gemini" | "system"> = {
    You: "user",
    Hank: "gemini",
    System: "system",
  };
  // Split on message boundaries: lines starting with **Label**:
  const parts = body.split(/\n\n(?=\*\*(?:You|Hank|System)\*\*:)/);
  for (const part of parts) {
    const msgMatch = part.match(/^\*\*(\w+)\*\*:\s*([\s\S]*)$/);
    if (msgMatch) {
      const role = labelToRole[msgMatch[1]] || "user";
      messages.push({ role, text: msgMatch[2].trim(), ts: 0 });
    }
  }
  return {
    id: fm.id || "",
    title: fm.title || "",
    messages,
    createdAt: fm.createdAt || "",
    duration: fm.duration ? Number(fm.duration) : undefined,
  };
}

// ─── Memories ────────────────────────────────────────────────────────────────

export interface Memory {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  category?: string;
  source?: string;
}

export function memoryToMarkdown(memory: Memory): string {
  const fm = buildFrontmatter([
    ["id", memory.id],
    ["createdAt", memory.createdAt],
    ["updatedAt", memory.updatedAt],
    ["category", memory.category],
    ["source", memory.source],
  ]);
  return `${fm}\n\n${memory.content}\n`;
}

export function markdownToMemory(md: string): Memory {
  const { frontmatter: fm, body } = parseFrontmatter(md);
  return {
    id: fm.id || "",
    content: body,
    createdAt: fm.createdAt || "",
    updatedAt: fm.updatedAt || "",
    category: fm.category || undefined,
    source: fm.source || undefined,
  };
}

// ─── Contacts ───────────────────────────────────────────────────────────────

export function contactToMarkdown(c: Contact): string {
  const fm = buildFrontmatter([
    ["id", c.id],
    ["name", c.name],
    ["company", c.company],
    ["email", c.email],
    ["phone", c.phone],
    ["tags", c.tags.length > 0 ? c.tags.join(", ") : undefined],
    ["lastContactDate", c.lastContactDate],
    ["createdAt", c.createdAt],
    ["updatedAt", c.updatedAt],
  ]);
  const bodyParts: string[] = [];
  bodyParts.push(`## Notes\n${c.notes || ""}`);
  bodyParts.push("\n## Interactions");
  for (const i of c.interactions) {
    bodyParts.push(`- ${i.date.slice(0, 10)} [${i.type}] ${i.summary}`);
  }
  return `${fm}\n\n${bodyParts.join("\n")}\n`;
}

export function markdownToContact(md: string): Contact {
  const { frontmatter: fm, body } = parseFrontmatter(md);
  const tags = fm.tags ? fm.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  // Parse notes: between ## Notes and ## Interactions
  const notesMatch = body.match(/## Notes\n([\s\S]*?)(?=\n## Interactions|$)/);
  const notes = notesMatch ? notesMatch[1].trim() : "";
  // Parse interactions
  const interactions: ContactInteraction[] = [];
  const interSection = body.match(/## Interactions\n([\s\S]*)$/);
  if (interSection) {
    const lines = interSection[1].trim().split("\n");
    for (const line of lines) {
      const m = line.match(/^- (\S+) \[(\w+)\] (.+)$/);
      if (m) {
        interactions.push({ date: m[1], type: m[2] as ContactInteraction["type"], summary: m[3] });
      }
    }
  }
  return {
    id: fm.id || "",
    name: fm.name || "",
    company: fm.company || undefined,
    email: fm.email || undefined,
    phone: fm.phone || undefined,
    notes: notes || undefined,
    tags,
    lastContactDate: fm.lastContactDate || undefined,
    interactions,
    createdAt: fm.createdAt || "",
    updatedAt: fm.updatedAt || "",
  };
}

// ─── Decisions ──────────────────────────────────────────────────────────────

export function decisionToMarkdown(d: Decision): string {
  const fm = buildFrontmatter([
    ["id", d.id],
    ["tags", d.tags.length > 0 ? d.tags.join(", ") : undefined],
    ["alternatives", d.alternatives.length > 0 ? d.alternatives.join(", ") : undefined],
    ["createdAt", d.createdAt],
  ]);
  return `${fm}\n\n# ${d.title}\n\n## Context\n${d.context}\n\n## Decision\n${d.decision}\n\n## Reasoning\n${d.reasoning}\n`;
}

export function markdownToDecision(md: string): Decision {
  const { frontmatter: fm, body } = parseFrontmatter(md);
  const tags = fm.tags ? fm.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const alternatives = fm.alternatives ? fm.alternatives.split(",").map((a) => a.trim()).filter(Boolean) : [];
  const titleMatch = body.match(/^# (.+)/);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const contextMatch = body.match(/## Context\n([\s\S]*?)(?=\n## Decision)/);
  const context = contextMatch ? contextMatch[1].trim() : "";
  const decisionMatch = body.match(/## Decision\n([\s\S]*?)(?=\n## Reasoning)/);
  const decision = decisionMatch ? decisionMatch[1].trim() : "";
  const reasoningMatch = body.match(/## Reasoning\n([\s\S]*)$/);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "";
  return { id: fm.id || "", title, context, decision, alternatives, reasoning, tags, createdAt: fm.createdAt || "" };
}

// ─── Calls (export only) ────────────────────────────────────────────────────

export interface CallData {
  id: string;
  phone: string;
  status: string;
  durationSeconds: number;
  startedAt: number;
  transcript?: Array<{ speaker: string; text: string; ts: number }>;
  summary?: string | null;
}

export function callToMarkdown(call: CallData): string {
  const fm = buildFrontmatter([
    ["id", call.id],
    ["phone", call.phone],
    ["status", call.status],
    ["durationSeconds", String(call.durationSeconds)],
    ["startedAt", new Date(call.startedAt).toISOString()],
  ]);
  const bodyParts: string[] = [];
  if (call.transcript && call.transcript.length > 0) {
    bodyParts.push("## Transcript\n");
    for (const entry of call.transcript) {
      bodyParts.push(`**${entry.speaker}**: ${entry.text}`);
    }
  }
  if (call.summary) {
    bodyParts.push("\n## Summary\n");
    bodyParts.push(call.summary);
  }
  return `${fm}\n\n${bodyParts.join("\n")}\n`;
}

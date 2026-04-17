import { randomUUID } from "crypto";

// ─── Platform Detection ─────────────────────────────────────────────────────

export type ImportPlatform = "chatgpt" | "claude" | "gemini" | "unknown";

export interface ImportResult {
  platform: ImportPlatform;
  memories: string[];
  conversations: number;
  messagesProcessed: number;
  skipped: number;
  errors: string[];
}

/**
 * Auto-detect which platform a JSON export belongs to.
 */
export function detectPlatform(data: unknown): ImportPlatform {
  if (!data) return "unknown";

  // ChatGPT: array of objects with "mapping" field (tree structure)
  if (Array.isArray(data) && data.length > 0 && data[0].mapping) return "chatgpt";

  // ChatGPT memories: array with "id" starting with "mem_"
  if (Array.isArray(data) && data.length > 0 && typeof data[0].id === "string" && data[0].id.startsWith("mem_")) return "chatgpt";

  // Claude: array of objects with "chat_messages" field
  if (Array.isArray(data) && data.length > 0 && data[0].chat_messages) return "claude";

  // Claude: object with uuid and chat_messages
  if (typeof data === "object" && !Array.isArray(data) && (data as any).chat_messages) return "claude";

  // Gemini: object with "messages" array where role is "model"
  if (typeof data === "object" && !Array.isArray(data) && Array.isArray((data as any).messages)) {
    const msgs = (data as any).messages;
    if (msgs.some((m: any) => m.role === "model")) return "gemini";
  }

  // Gemini: array of conversation objects with messages containing role "model"
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0].messages)) {
    if (data[0].messages.some((m: any) => m.role === "model")) return "gemini";
  }

  return "unknown";
}

// ─── ChatGPT Import ─────────────────────────────────────────────────────────

/**
 * Import ChatGPT memories (memories.json) — direct facts.
 */
export function parseChatGPTMemories(data: any[]): string[] {
  return data
    .filter(item => item.content && typeof item.content === "string")
    .map(item => item.content.trim())
    .filter(Boolean);
}

/**
 * Extract user messages from ChatGPT conversations.json tree structure.
 * Walk from current_node back through parent pointers to reconstruct linear thread.
 */
export function parseChatGPTConversations(data: any[]): { conversations: number; messages: Array<{ role: string; content: string; conversationTitle?: string }> } {
  const allMessages: Array<{ role: string; content: string; conversationTitle?: string }> = [];
  let conversations = 0;

  for (const conv of data) {
    if (!conv.mapping) continue;
    conversations++;
    const title = conv.title || "Untitled";

    // Reconstruct linear thread from tree
    let nodeId = conv.current_node;
    const chain: any[] = [];
    while (nodeId && conv.mapping[nodeId]) {
      const node = conv.mapping[nodeId];
      if (node.message?.content?.parts) {
        const text = node.message.content.parts
          .filter((p: any) => typeof p === "string")
          .join("\n")
          .trim();
        if (text) {
          chain.push({
            role: node.message.author?.role === "user" ? "user" : "assistant",
            content: text,
            conversationTitle: title,
          });
        }
      }
      nodeId = node.parent;
    }
    chain.reverse();
    allMessages.push(...chain);
  }

  return { conversations, messages: allMessages };
}

// ─── Claude Import ──────────────────────────────────────────────────────────

/**
 * Extract messages from Claude conversations.json export.
 */
export function parseClaudeConversations(data: any[]): { conversations: number; messages: Array<{ role: string; content: string; conversationTitle?: string }> } {
  const allMessages: Array<{ role: string; content: string; conversationTitle?: string }> = [];
  let conversations = 0;

  const convList = Array.isArray(data) ? data : [data];

  for (const conv of convList) {
    if (!conv.chat_messages) continue;
    conversations++;
    const title = conv.name || "Untitled";

    for (const msg of conv.chat_messages) {
      const text = typeof msg.text === "string" ? msg.text.trim() : "";
      if (!text) continue;
      allMessages.push({
        role: msg.sender === "human" ? "user" : "assistant",
        content: text,
        conversationTitle: title,
      });
    }
  }

  return { conversations, messages: allMessages };
}

// ─── Gemini Import ──────────────────────────────────────────────────────────

/**
 * Extract messages from Gemini export (Google Takeout format).
 */
export function parseGeminiConversations(data: any): { conversations: number; messages: Array<{ role: string; content: string; conversationTitle?: string }> } {
  const allMessages: Array<{ role: string; content: string; conversationTitle?: string }> = [];
  let conversations = 0;

  const convList = Array.isArray(data) ? data : [data];

  for (const conv of convList) {
    if (!Array.isArray(conv.messages)) continue;
    conversations++;
    const title = conv.title || "Untitled";

    for (const msg of conv.messages) {
      const text = typeof msg.content === "string" ? msg.content.trim() : "";
      if (!text) continue;
      allMessages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: text,
        conversationTitle: title,
      });
    }
  }

  return { conversations, messages: allMessages };
}

// ─── Fact Extraction ────────────────────────────────────────────────────────

/**
 * Extract memorable facts from user messages without LLM.
 * Simple heuristic: look for "I am", "I work", "I prefer", "My name", etc.
 */
export function extractFactsHeuristic(messages: Array<{ role: string; content: string }>): string[] {
  const userMessages = messages.filter(m => m.role === "user");
  const facts: Set<string> = new Set();

  const patterns = [
    /\b(?:I am|I'm|Ich bin)\s+(.{5,80})/gi,
    /\b(?:my name is|mein name ist)\s+(.{2,40})/gi,
    /\b(?:I work|I'm working|Ich arbeite)\s+(.{5,80})/gi,
    /\b(?:I prefer|I like|Ich bevorzuge|Ich mag)\s+(.{5,80})/gi,
    /\b(?:I use|I'm using|Ich verwende|Ich nutze)\s+(.{5,80})/gi,
    /\b(?:I live|I'm from|Ich wohne|Ich komme aus)\s+(.{3,60})/gi,
    /\b(?:my company|my business|meine firma|mein unternehmen)\s+(.{3,60})/gi,
    /\b(?:I always|Ich immer)\s+(.{5,80})/gi,
    /\b(?:I need|I want|Ich brauche|Ich will)\s+(.{5,80})/gi,
    /\b(?:my timezone|my language|my email)\s+(.{3,60})/gi,
    /\b(?:remember that|merke dir|vergiss nicht)\s+(.{5,120})/gi,
  ];

  for (const msg of userMessages) {
    const content = msg.content;
    // Skip very long messages (likely code or documents)
    if (content.length > 500) continue;

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        // Clean up the match — take first sentence
        let fact = match[0].trim();
        const dotIdx = fact.indexOf(".");
        if (dotIdx > 10) fact = fact.slice(0, dotIdx + 1);
        // Remove trailing punctuation patterns
        fact = fact.replace(/[,;:]\s*$/, "").trim();
        if (fact.length >= 10 && fact.length <= 200) {
          facts.add(fact);
        }
      }
    }
  }

  return [...facts];
}

// ─── Main Import Function ───────────────────────────────────────────────────

export interface ImportOptions {
  mode: "memories" | "conversations" | "both";
  extractFacts: boolean; // use heuristic extraction from conversations
  maxConversations?: number; // limit for large exports
}

export function processImport(data: unknown, platform: ImportPlatform, options: ImportOptions): ImportResult {
  const result: ImportResult = {
    platform,
    memories: [],
    conversations: 0,
    messagesProcessed: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Direct memories import (ChatGPT memories.json)
    if (Array.isArray(data) && data.length > 0 && data[0].id?.startsWith?.("mem_")) {
      const mems = parseChatGPTMemories(data);
      result.memories.push(...mems);
      result.platform = "chatgpt";
      return result;
    }

    // Conversation-based import
    let parsed: { conversations: number; messages: Array<{ role: string; content: string }> };

    switch (platform) {
      case "chatgpt":
        parsed = parseChatGPTConversations(data as any[]);
        break;
      case "claude":
        parsed = parseClaudeConversations(data as any[]);
        break;
      case "gemini":
        parsed = parseGeminiConversations(data);
        break;
      default:
        result.errors.push("Unknown platform format. Please select the correct platform.");
        return result;
    }

    result.conversations = parsed.conversations;
    result.messagesProcessed = parsed.messages.length;

    // Limit conversations if needed
    const maxMsgs = (options.maxConversations || 1000) * 20; // ~20 msgs per conversation
    const msgs = parsed.messages.slice(0, maxMsgs);
    if (parsed.messages.length > maxMsgs) {
      result.skipped = parsed.messages.length - maxMsgs;
    }

    // Extract facts from conversations
    if (options.extractFacts || options.mode === "both") {
      const facts = extractFactsHeuristic(msgs);
      result.memories.push(...facts);
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : "Import failed");
  }

  // Deduplicate memories
  result.memories = [...new Set(result.memories)];

  return result;
}

// ─── Email Service ────────────────────────────────────────────────────────────
// Multi-account IMAP/SMTP email integration for the personal assistant.

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

const CONFIG_PATH = join(HEYHANK_HOME, "assistant", "email-accounts.json");

export interface EmailAccount {
  id: string;
  name: string; // display name, e.g. "Work" or "Gmail"
  email: string;
  imap: {
    host: string;
    port: number;
    secure: boolean;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
  };
  auth: {
    user: string;
    pass: string;
  };
}

export interface EmailSummary {
  uid: number;
  subject: string;
  from: string;
  to: string;
  date: string;
  seen: boolean;
  accountId: string;
  accountName: string;
}

export interface EmailFull extends EmailSummary {
  textBody: string;
  htmlBody?: string;
}

// ─── Account Management ──────────────────────────────────────────────────────

function ensureDir(): void {
  const dir = join(HEYHANK_HOME, "assistant");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadAccounts(): EmailAccount[] {
  ensureDir();
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as EmailAccount[];
    }
  } catch {}
  return [];
}

export function saveAccounts(accounts: EmailAccount[]): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(accounts, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function addAccount(account: Omit<EmailAccount, "id">): EmailAccount {
  const accounts = loadAccounts();
  const newAccount: EmailAccount = {
    ...account,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  };
  accounts.push(newAccount);
  saveAccounts(accounts);
  return newAccount;
}

export function removeAccount(id: string): boolean {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  accounts.splice(idx, 1);
  saveAccounts(accounts);
  return true;
}

/** Simple similarity score (0-1) between two strings */
function similarity(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return 1;
  if (al.includes(bl) || bl.includes(al)) return 0.8;
  // Character overlap (Dice coefficient)
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const aBi = bigrams(al);
  const bBi = bigrams(bl);
  let overlap = 0;
  for (const bi of aBi) if (bBi.has(bi)) overlap++;
  return aBi.size + bBi.size > 0 ? (2 * overlap) / (aBi.size + bBi.size) : 0;
}

/** Find account by exact match or fuzzy match (tolerates typos like "Basecamp" for "Baseloq") */
export function getAccount(idOrEmail: string): EmailAccount | undefined {
  const accounts = loadAccounts();
  // Exact matches first
  const exact = accounts.find((a) => a.id === idOrEmail || a.email === idOrEmail || a.name.toLowerCase() === idOrEmail.toLowerCase());
  if (exact) return exact;

  // Fuzzy match on name and email (threshold 0.4)
  let best: EmailAccount | undefined;
  let bestScore = 0.4; // minimum threshold
  for (const a of accounts) {
    const nameScore = similarity(idOrEmail, a.name);
    const emailScore = similarity(idOrEmail, a.email.split("@")[0]);
    const score = Math.max(nameScore, emailScore);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

// ─── IMAP Operations ─────────────────────────────────────────────────────────

async function withImap<T>(account: EmailAccount, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    auth: {
      user: account.auth.user,
      pass: account.auth.pass,
    },
    logger: false,
  });

  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

function formatAddress(addr: any): string {
  if (!addr) return "";
  if (Array.isArray(addr)) {
    return addr.map(formatAddress).join(", ");
  }
  if (addr.name && addr.address) return `${addr.name} <${addr.address}>`;
  if (addr.address) return addr.address;
  return String(addr);
}

/** List recent emails from a specific account */
export async function listEmails(
  account: EmailAccount,
  options?: { folder?: string; limit?: number; unseen?: boolean },
): Promise<EmailSummary[]> {
  const folder = options?.folder || "INBOX";
  const limit = options?.limit || 10;

  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const emails: EmailSummary[] = [];
      // Fetch most recent messages
      const range = options?.unseen ? "1:*" : "*";
      const searchCriteria = options?.unseen ? { seen: false } : undefined;

      let uids: number[];
      if (searchCriteria) {
        uids = await client.search(searchCriteria) as unknown as number[];
      } else {
        uids = await client.search({ all: true }) as unknown as number[];
      }

      // Take the last N UIDs (most recent)
      const recentUids = uids.slice(-limit);

      for await (const msg of client.fetch(recentUids, { envelope: true, flags: true })) {
        emails.push({
          uid: msg.uid,
          subject: msg.envelope?.subject || "(no subject)",
          from: formatAddress(msg.envelope?.from),
          to: formatAddress(msg.envelope?.to),
          date: msg.envelope?.date?.toISOString() || "",
          seen: msg.flags?.has("\\Seen") || false,
          accountId: account.id,
          accountName: account.name,
        });
      }

      return emails.reverse(); // newest first
    } finally {
      lock.release();
    }
  });
}

/** Read a specific email by UID */
export async function readEmail(account: EmailAccount, uid: number, folder = "INBOX"): Promise<EmailFull | null> {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const msg = await client.fetchOne(String(uid), { envelope: true, flags: true, source: true }, { uid: true });
      if (!msg) return null;

      // Parse the raw source to extract text body
      const source = msg.source?.toString("utf-8") || "";
      let textBody = "";

      // Simple text extraction from raw email
      const parts = source.split(/\r?\n\r?\n/);
      if (parts.length > 1) {
        textBody = parts.slice(1).join("\n\n");
        // Strip HTML tags for a rough text version
        textBody = textBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        // Limit length
        if (textBody.length > 2000) {
          textBody = textBody.slice(0, 2000) + "...";
        }
      }

      // Mark as seen
      await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });

      return {
        uid: msg.uid,
        subject: msg.envelope?.subject || "(no subject)",
        from: formatAddress(msg.envelope?.from),
        to: formatAddress(msg.envelope?.to),
        date: msg.envelope?.date?.toISOString() || "",
        seen: true,
        accountId: account.id,
        accountName: account.name,
        textBody,
      };
    } finally {
      lock.release();
    }
  });
}

/** Search emails across one account */
export async function searchEmails(
  account: EmailAccount,
  query: string,
  limit = 10,
): Promise<EmailSummary[]> {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({
        or: [
          { subject: query },
          { from: query },
          { body: query },
        ],
      }) as unknown as number[];

      const recentUids = uids.slice(-limit);
      const emails: EmailSummary[] = [];

      for await (const msg of client.fetch(recentUids, { envelope: true, flags: true })) {
        emails.push({
          uid: msg.uid,
          subject: msg.envelope?.subject || "(no subject)",
          from: formatAddress(msg.envelope?.from),
          to: formatAddress(msg.envelope?.to),
          date: msg.envelope?.date?.toISOString() || "",
          seen: msg.flags?.has("\\Seen") || false,
          accountId: account.id,
          accountName: account.name,
        });
      }

      return emails.reverse();
    } finally {
      lock.release();
    }
  });
}

// ─── SMTP Operations ─────────────────────────────────────────────────────────

/** Send an email */
export async function sendEmail(
  account: EmailAccount,
  to: string,
  subject: string,
  body: string,
): Promise<{ messageId: string }> {
  const transporter = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: {
      user: account.auth.user,
      pass: account.auth.pass,
    },
  });

  const info = await transporter.sendMail({
    from: `${account.name} <${account.email}>`,
    to,
    subject,
    text: body,
  });

  return { messageId: info.messageId };
}

/** Reply to an email */
export async function replyToEmail(
  account: EmailAccount,
  originalUid: number,
  body: string,
  folder = "INBOX",
): Promise<{ messageId: string }> {
  // First fetch the original email to get reply details
  const original = await readEmail(account, originalUid, folder);
  if (!original) throw new Error("Original email not found");

  const replyTo = original.from;
  const subject = original.subject.startsWith("Re:") ? original.subject : `Re: ${original.subject}`;

  return sendEmail(account, replyTo, subject, body);
}

// ─── Convenience: Multi-account operations ───────────────────────────────────

/** Get unread count across all accounts */
export async function getUnreadSummary(): Promise<Array<{ accountName: string; email: string; unread: number }>> {
  const accounts = loadAccounts();
  const results = await Promise.allSettled(
    accounts.map(async (acc) => {
      const emails = await listEmails(acc, { unseen: true, limit: 100 });
      return { accountName: acc.name, email: acc.email, unread: emails.length };
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<{ accountName: string; email: string; unread: number }> => r.status === "fulfilled")
    .map((r) => r.value);
}

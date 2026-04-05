// ─── Calendar Service ─────────────────────────────────────────────────────────
// Multi-account CalDAV calendar integration for the personal assistant.
// Supports Google Calendar, iCloud, Nextcloud, and any CalDAV-compatible server.

import { DAVClient, DAVCalendar } from "tsdav";
import ICAL from "ical.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";

const CONFIG_PATH = join(HEYHANK_HOME, "assistant", "calendar-accounts.json");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CalendarAccount {
  id: string;
  name: string;           // display name, e.g. "Google" or "iCloud"
  provider: "google" | "icloud" | "caldav"; // preset or custom
  serverUrl: string;      // CalDAV server URL
  auth: {
    user: string;
    pass: string;         // App Password for Google/iCloud
  };
  defaultCalendarId?: string; // preferred calendar for this account
}

export interface CalendarEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;          // ISO datetime
  end: string;            // ISO datetime
  allDay: boolean;
  recurrence?: string;
  status?: string;        // CONFIRMED, TENTATIVE, CANCELLED
  organizer?: string;
  attendees?: string[];
  calendarName?: string;
  accountId: string;
  accountName: string;
}

export interface CalendarInfo {
  url: string;
  displayName: string;
  ctag?: string;
  accountId: string;
}

// ─── Provider Presets ────────────────────────────────────────────────────────

export const PROVIDER_PRESETS: Record<string, { serverUrl: string; label: string; helpText: string }> = {
  google: {
    serverUrl: "https://apidata.googleusercontent.com/caldav/v2/",
    label: "Google Calendar",
    helpText: "Use your Gmail address and an App Password (myaccount.google.com/apppasswords). 2FA must be enabled.",
  },
  icloud: {
    serverUrl: "https://caldav.icloud.com/",
    label: "iCloud Calendar",
    helpText: "Use your Apple ID email and an App-Specific Password (appleid.apple.com → Sign-In and Security → App-Specific Passwords).",
  },
  outlook: {
    serverUrl: "https://outlook.office365.com/caldav/",
    label: "Outlook Calendar",
    helpText: "Use your Outlook/Hotmail email and an App Password (account.microsoft.com → Security → App passwords). 2-Step Verification must be enabled.",
  },
  caldav: {
    serverUrl: "",
    label: "Custom CalDAV",
    helpText: "Enter the full CalDAV URL of your server (e.g. https://cloud.example.com/remote.php/dav/ for Nextcloud).",
  },
};

// ─── Account Management ──────────────────────────────────────────────────────

function ensureDir(): void {
  const dir = join(HEYHANK_HOME, "assistant");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadAccounts(): CalendarAccount[] {
  ensureDir();
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as CalendarAccount[];
    }
  } catch { /* ignore */ }
  return [];
}

export function saveAccounts(accounts: CalendarAccount[]): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(accounts, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function addAccount(data: Omit<CalendarAccount, "id">): CalendarAccount {
  const accounts = loadAccounts();
  const account: CalendarAccount = {
    ...data,
    id: `cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  };
  accounts.push(account);
  saveAccounts(accounts);
  return account;
}

export function removeAccount(id: string): boolean {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  accounts.splice(idx, 1);
  saveAccounts(accounts);
  return true;
}

// Fuzzy match for Gemini tool calls
function similarity(a: string, b: string): number {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  // Dice coefficient
  const bigrams = (s: string) => {
    const set: string[] = [];
    for (let i = 0; i < s.length - 1; i++) set.push(s.slice(i, i + 2));
    return set;
  };
  const aBi = bigrams(a);
  const bBi = bigrams(b);
  let matches = 0;
  for (const bi of aBi) if (bBi.includes(bi)) matches++;
  return (2 * matches) / (aBi.length + bBi.length) || 0;
}

export function getAccount(idOrName: string): CalendarAccount | undefined {
  const accounts = loadAccounts();
  const exact = accounts.find((a) => a.id === idOrName || a.name.toLowerCase() === idOrName.toLowerCase());
  if (exact) return exact;
  let best: CalendarAccount | undefined;
  let bestScore = 0;
  for (const a of accounts) {
    const score = Math.max(similarity(idOrName, a.name), similarity(idOrName, a.auth.user));
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return bestScore >= 0.4 ? best : undefined;
}

// ─── CalDAV Client ───────────────────────────────────────────────────────────

async function createClient(account: CalendarAccount): Promise<DAVClient> {
  const client = new DAVClient({
    serverUrl: account.serverUrl,
    credentials: {
      username: account.auth.user,
      password: account.auth.pass,
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
  await client.login();
  return client;
}

// ─── Calendar Operations ─────────────────────────────────────────────────────

/** Filter to only VEVENT calendars (exclude VTODO/Reminders) */
function isEventCalendar(cal: DAVCalendar): boolean {
  const components = (cal as unknown as { components?: string[] }).components;
  if (!components || components.length === 0) return true; // assume event calendar if unknown
  return components.includes("VEVENT");
}

/** List all calendars for an account */
export async function listCalendars(account: CalendarAccount): Promise<CalendarInfo[]> {
  const client = await createClient(account);
  const calendars = await client.fetchCalendars();
  return calendars.filter(isEventCalendar).map((cal) => ({
    url: cal.url,
    displayName: (typeof cal.displayName === "string" ? cal.displayName : null) || "Unnamed",
    ctag: cal.ctag,
    accountId: account.id,
  }));
}

/** Parse ICS data into CalendarEvent objects */
function parseICS(icsData: string, accountId: string, accountName: string, calendarName?: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  try {
    const jcal = ICAL.parse(icsData);
    const comp = new ICAL.Component(jcal);
    const vevents = comp.getAllSubcomponents("vevent");

    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);
      const dtstart = vevent.getFirstPropertyValue("dtstart") as ICAL.Time | null;
      const dtend = vevent.getFirstPropertyValue("dtend") as ICAL.Time | null;

      const allDay = dtstart?.isDate || false;
      const start = dtstart ? (allDay ? dtstart.toString() : dtstart.toJSDate().toISOString()) : "";
      const end = dtend ? (allDay ? dtend.toString() : dtend.toJSDate().toISOString()) : start;

      const attendeeProps = vevent.getAllProperties("attendee");
      const attendees = attendeeProps.map((a) => {
        const cn = a.getParameter("cn");
        const val = (a.getFirstValue() as string || "").replace("mailto:", "");
        return cn ? `${cn} <${val}>` : val;
      });

      events.push({
        uid: event.uid || "",
        summary: event.summary || "(No title)",
        description: event.description || undefined,
        location: event.location || undefined,
        start,
        end,
        allDay,
        status: vevent.getFirstPropertyValue("status") as string || undefined,
        organizer: (vevent.getFirstPropertyValue("organizer") as string || "").replace("mailto:", "") || undefined,
        attendees: attendees.length > 0 ? attendees : undefined,
        calendarName,
        accountId,
        accountName,
      });
    }
  } catch (err) {
    console.error("[calendar-service] ICS parse error:", err);
  }
  return events;
}

/** Fetch events from a specific date range */
export async function listEvents(
  account: CalendarAccount,
  opts: { from?: string; to?: string; calendarUrl?: string } = {},
): Promise<CalendarEvent[]> {
  const client = await createClient(account);
  const allCalendars = await client.fetchCalendars();
  const calendars = allCalendars.filter(isEventCalendar);

  // Filter to specific calendar if requested
  const targetCalendars = opts.calendarUrl
    ? calendars.filter((c) => c.url === opts.calendarUrl)
    : calendars;

  if (targetCalendars.length === 0) return [];

  // Default: today to 7 days ahead
  const now = new Date();
  const from = opts.from ? new Date(opts.from) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = opts.to ? new Date(opts.to) : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

  const allEvents: CalendarEvent[] = [];

  for (const cal of targetCalendars) {
    try {
      const objects = await client.fetchCalendarObjects({
        calendar: cal as DAVCalendar,
        timeRange: {
          start: from.toISOString(),
          end: to.toISOString(),
        },
      });

      for (const obj of objects) {
        if (obj.data) {
          const calName = typeof cal.displayName === "string" ? cal.displayName : undefined;
          const events = parseICS(obj.data, account.id, account.name, calName);
          allEvents.push(...events);
        }
      }
    } catch (err) {
      console.error(`[calendar-service] Error fetching from calendar "${cal.displayName}":`, err);
    }
  }

  // Sort by start time
  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return allEvents;
}

/** Create a new calendar event */
export async function createEvent(
  account: CalendarAccount,
  event: {
    summary: string;
    description?: string;
    location?: string;
    start: string;       // ISO datetime or YYYY-MM-DD for all-day
    end: string;         // ISO datetime or YYYY-MM-DD for all-day
    allDay?: boolean;
    calendarUrl?: string;
  },
): Promise<{ success: boolean; uid: string }> {
  const client = await createClient(account);
  const allCalendars = await client.fetchCalendars();
  const calendars = allCalendars.filter(isEventCalendar);

  // Pick target calendar (only event calendars, never Reminders/VTODO)
  let targetCal = event.calendarUrl
    ? calendars.find((c) => c.url === event.calendarUrl)
    : (account.defaultCalendarId
      ? calendars.find((c) => c.url === account.defaultCalendarId)
      : calendars[0]);

  if (!targetCal) targetCal = calendars[0];
  if (!targetCal) throw new Error("No calendar found on this account");

  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@heyhank`;

  // Build ICS
  const dtStart = event.allDay
    ? `;VALUE=DATE:${event.start.replace(/-/g, "")}`
    : `:${new Date(event.start).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
  const dtEnd = event.allDay
    ? `;VALUE=DATE:${event.end.replace(/-/g, "")}`
    : `:${new Date(event.end).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HeyHank//Calendar//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART${dtStart}`,
    `DTEND${dtEnd}`,
    `SUMMARY:${escapeICS(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeICS(event.location)}`);
  lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  const icsData = lines.join("\r\n");

  await client.createCalendarObject({
    calendar: targetCal as DAVCalendar,
    filename: `${uid}.ics`,
    iCalString: icsData,
  });

  return { success: true, uid };
}

/** Delete a calendar event by UID */
export async function deleteEvent(
  account: CalendarAccount,
  uid: string,
): Promise<boolean> {
  const client = await createClient(account);
  const allCalendars = await client.fetchCalendars();
  const calendars = allCalendars.filter(isEventCalendar);

  for (const cal of calendars) {
    try {
      const objects = await client.fetchCalendarObjects({ calendar: cal as DAVCalendar });
      for (const obj of objects) {
        if (obj.data?.includes(uid) && obj.url) {
          await client.deleteCalendarObject({ calendarObject: { url: obj.url, etag: obj.etag || "" } });
          return true;
        }
      }
    } catch { /* continue searching */ }
  }
  return false;
}

/** Search events by text query */
export async function searchEvents(
  account: CalendarAccount,
  query: string,
  opts: { from?: string; to?: string } = {},
): Promise<CalendarEvent[]> {
  // CalDAV text search isn't universally supported, so fetch and filter locally
  const now = new Date();
  const from = opts.from || new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const to = opts.to || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  const events = await listEvents(account, { from, to });
  const q = query.toLowerCase();
  return events.filter((e) =>
    e.summary.toLowerCase().includes(q) ||
    (e.description || "").toLowerCase().includes(q) ||
    (e.location || "").toLowerCase().includes(q),
  );
}

/** Get a summary of upcoming events across all accounts */
export async function getUpcomingSummary(): Promise<{
  account: string;
  todayCount: number;
  weekCount: number;
  nextEvent?: { summary: string; start: string };
}[]> {
  const accounts = loadAccounts();
  const results = [];
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  for (const account of accounts) {
    try {
      const weekEvents = await listEvents(account, {
        from: now.toISOString(),
        to: weekEnd.toISOString(),
      });
      const todayEvents = weekEvents.filter((e) => new Date(e.start) < todayEnd);
      results.push({
        account: account.name,
        todayCount: todayEvents.length,
        weekCount: weekEvents.length,
        nextEvent: weekEvents[0] ? { summary: weekEvents[0].summary, start: weekEvents[0].start } : undefined,
      });
    } catch (err) {
      results.push({
        account: account.name,
        todayCount: 0,
        weekCount: 0,
      });
    }
  }
  return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeICS(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

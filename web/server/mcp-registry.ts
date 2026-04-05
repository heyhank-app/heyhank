// ─── MCP Server Registry ──────────────────────────────────────────────────────
// Manages MCP server configurations: add, remove, enable/disable, catalog install.

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { HEYHANK_HOME } from "./paths.js";
import { randomUUID } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface McpServerEntry {
  id: string;
  name: string;
  description: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled: boolean;
  assignedAgents: string[];
  requiresAuth?: { field: string; label: string; helpText: string }[];
  authValues?: Record<string, string>;
}

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  requiresAuth?: { field: string; label: string; helpText: string }[];
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const CONFIG_PATH = join(HEYHANK_HOME, "mcp-servers.json");

function ensureDir(): void {
  if (!existsSync(HEYHANK_HOME)) {
    mkdirSync(HEYHANK_HOME, { recursive: true });
  }
}

// ─── Persistence ────────────────────────────────────────────────────────────

function loadServers(): McpServerEntry[] {
  ensureDir();
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as McpServerEntry[];
    }
  } catch { /* ignore corrupt files */ }
  return [];
}

function saveServers(servers: McpServerEntry[]): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(servers, null, 2), "utf-8");
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch { /* may fail on some platforms */ }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueId(name: string, existing: McpServerEntry[]): string {
  const base = slugify(name);
  if (!existing.some((s) => s.id === base)) return base;
  // Append short suffix to avoid collision
  const suffix = randomUUID().slice(0, 6);
  return `${base}-${suffix}`;
}

// ─── Catalog ────────────────────────────────────────────────────────────────

const CATALOG: CatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Pull Requests, Issues und Repositories verwalten via GitHub API.",
    category: "development",
    type: "http",
    url: "https://api.githubcopilot.com/mcp/",
    requiresAuth: [
      { field: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub Personal Access Token", helpText: "Erstelle ein Token unter github.com/settings/tokens mit repo & issues Berechtigung." },
    ],
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "Browser-Automatisierung und Testing mit Playwright MCP.",
    category: "browser",
    type: "stdio",
    command: "npx",
    args: ["@playwright/mcp@latest"],
  },
  {
    id: "context7",
    name: "Context7",
    description: "Dokumentations-Lookup fuer Bibliotheken und Frameworks. Liefert aktuelle Docs direkt in den Kontext.",
    category: "development",
    type: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp@latest"],
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web-Suche ohne Google. Nutzt die Brave Search API fuer datenschutzfreundliche Suchergebnisse.",
    category: "search",
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-brave-search"],
    env: { BRAVE_API_KEY: "" },
    requiresAuth: [
      { field: "BRAVE_API_KEY", label: "Brave API Key", helpText: "API-Key von brave.com/search/api erstellen (kostenlos bis 2000 Anfragen/Monat)." },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Notion-Seiten und Datenbanken lesen und bearbeiten.",
    category: "productivity",
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-notion"],
    env: { NOTION_API_KEY: "" },
    requiresAuth: [
      { field: "NOTION_API_KEY", label: "Notion Integration Token", helpText: "Erstelle eine Integration unter notion.so/my-integrations und kopiere den Secret." },
    ],
  },
  {
    id: "zapier",
    name: "Zapier",
    description: "Zugriff auf ueber 5000+ App-Automationen via Zapier MCP.",
    category: "productivity",
    type: "http",
    url: "https://actions.zapier.com/mcp/",
    requiresAuth: [
      { field: "ZAPIER_API_KEY", label: "Zapier API Key", helpText: "API-Key aus den Zapier-Einstellungen unter zapier.com/app/settings kopieren." },
    ],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Google Docs, Sheets und Drive-Dateien durchsuchen und verwalten.",
    category: "productivity",
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-google-drive"],
    env: { GOOGLE_APPLICATION_CREDENTIALS: "" },
    requiresAuth: [
      { field: "GOOGLE_APPLICATION_CREDENTIALS", label: "Google Service Account JSON-Pfad", helpText: "Pfad zur Service-Account JSON-Datei. Erstelle einen Service Account in der Google Cloud Console." },
    ],
  },
  {
    id: "google-maps",
    name: "Google Maps",
    description: "Orte, Adressen und Routen via Google Maps API abfragen.",
    category: "other",
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-google-maps"],
    env: { GOOGLE_MAPS_API_KEY: "" },
    requiresAuth: [
      { field: "GOOGLE_MAPS_API_KEY", label: "Google Maps API Key", helpText: "API-Key in der Google Cloud Console unter APIs & Services erstellen." },
    ],
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "Browser-Automatisierung mit Puppeteer. Screenshots, Navigation, Formular-Ausfuellung.",
    category: "browser",
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-puppeteer"],
  },
  {
    id: "memory",
    name: "Memory",
    description: "Langzeit-Gedaechtnis fuer Agenten. Speichert und ruft Wissen ueber Sessions hinweg ab.",
    category: "ai",
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-memory"],
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Kontrollierter Dateizugriff. Lesen, Schreiben und Durchsuchen von Dateien in definierten Verzeichnissen.",
    category: "other",
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-filesystem", "/home"],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Slack-Nachrichten lesen und senden. Channels und Threads verwalten.",
    category: "communication",
    type: "http",
    url: "https://slack.com/api/mcp",
    requiresAuth: [
      { field: "SLACK_BOT_TOKEN", label: "Slack Bot Token", helpText: "Bot Token (xoxb-...) aus der Slack App Konfiguration unter api.slack.com/apps." },
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Zahlungen, Kunden und Abonnements ueber die Stripe API verwalten.",
    category: "database",
    type: "http",
    url: "https://mcp.stripe.com/",
    requiresAuth: [
      { field: "STRIPE_API_KEY", label: "Stripe Secret Key", helpText: "Secret Key aus dem Stripe Dashboard unter dashboard.stripe.com/apikeys." },
    ],
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Supabase-Datenbank abfragen und verwalten. SQL-Queries und Tabellen-Operationen.",
    category: "database",
    type: "http",
    url: "https://supabase.com/api/mcp",
    requiresAuth: [
      { field: "SUPABASE_URL", label: "Supabase Project URL", helpText: "Projekt-URL aus dem Supabase Dashboard (z.B. https://xyz.supabase.co)." },
      { field: "SUPABASE_SERVICE_ROLE_KEY", label: "Supabase Service Role Key", helpText: "Service Role Key aus den Supabase Projekt-Einstellungen > API." },
    ],
  },
  {
    id: "firebase",
    name: "Firebase",
    description: "Firebase-Projekte verwalten. Firestore, Auth, Hosting und Cloud Functions.",
    category: "database",
    type: "stdio",
    command: "npx",
    args: ["-y", "firebase-mcp-server"],
    env: { GOOGLE_APPLICATION_CREDENTIALS: "" },
    requiresAuth: [
      { field: "GOOGLE_APPLICATION_CREDENTIALS", label: "Firebase Service Account JSON-Pfad", helpText: "Pfad zur Service-Account JSON-Datei aus der Firebase Console." },
    ],
  },
  {
    id: "exa",
    name: "Exa",
    description: "KI-optimierte Web-Suche. Semantische Suche und Content-Extraktion.",
    category: "search",
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic/mcp-server-exa"],
    env: { EXA_API_KEY: "" },
    requiresAuth: [
      { field: "EXA_API_KEY", label: "Exa API Key", helpText: "API-Key von exa.ai erstellen." },
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Fehler-Tracking und Performance-Monitoring. Issues und Events aus Sentry abfragen.",
    category: "development",
    type: "stdio",
    command: "npx",
    args: ["-y", "@sentry/mcp-server"],
    env: { SENTRY_AUTH_TOKEN: "" },
    requiresAuth: [
      { field: "SENTRY_AUTH_TOKEN", label: "Sentry Auth Token", helpText: "Auth Token unter sentry.io/settings/auth-tokens erstellen." },
    ],
  },
  {
    id: "figma",
    name: "Figma",
    description: "Figma-Designs und Dateien lesen. Frames, Komponenten und Styles abfragen.",
    category: "development",
    type: "http",
    url: "https://api.figma.com/mcp",
    requiresAuth: [
      { field: "FIGMA_ACCESS_TOKEN", label: "Figma Access Token", helpText: "Personal Access Token unter figma.com/developers/api erstellen." },
    ],
  },
  {
    id: "nanobanana",
    name: "nanobanana",
    description: "KI-Bildgenerierung. Erstellt Bilder aus Text-Beschreibungen via nanobanana.",
    category: "ai",
    type: "stdio",
    command: "npx",
    args: ["-y", "nanobanana-mcp"],
  },
];

// ─── CRUD Operations ────────────────────────────────────────────────────────

export function listServers(): McpServerEntry[] {
  return loadServers();
}

export function getServer(id: string): McpServerEntry | undefined {
  return loadServers().find((s) => s.id === id);
}

export function addServer(entry: Omit<McpServerEntry, "id">): McpServerEntry {
  const servers = loadServers();
  const server: McpServerEntry = {
    ...entry,
    id: uniqueId(entry.name, servers),
  };
  servers.push(server);
  saveServers(servers);
  return server;
}

export function addFromCatalog(catalogId: string): McpServerEntry {
  const template = CATALOG.find((c) => c.id === catalogId);
  if (!template) {
    throw new Error(`Catalog entry "${catalogId}" not found`);
  }

  const servers = loadServers();

  // Check if already installed
  if (servers.some((s) => s.id === catalogId)) {
    throw new Error(`MCP server "${template.name}" is already installed`);
  }

  const server: McpServerEntry = {
    id: template.id,
    name: template.name,
    description: template.description,
    type: template.type,
    command: template.command,
    args: template.args ? [...template.args] : undefined,
    url: template.url,
    headers: template.headers ? { ...template.headers } : undefined,
    env: template.env ? { ...template.env } : undefined,
    enabled: true,
    assignedAgents: ["*"],
    requiresAuth: template.requiresAuth,
    authValues: {},
  };

  servers.push(server);
  saveServers(servers);
  return server;
}

export function updateServer(
  id: string,
  updates: Partial<McpServerEntry>,
): McpServerEntry | null {
  const servers = loadServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  // Prevent changing ID
  const { id: _ignoreId, ...safeUpdates } = updates;
  servers[idx] = { ...servers[idx], ...safeUpdates };
  saveServers(servers);
  return servers[idx];
}

export function removeServer(id: string): boolean {
  const servers = loadServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  servers.splice(idx, 1);
  saveServers(servers);
  return true;
}

export function getCatalog(): CatalogEntry[] {
  const installed = loadServers();
  // Return catalog with an "installed" hint by checking existing servers
  return CATALOG.map((c) => ({
    ...c,
    installed: installed.some((s) => s.id === c.id),
  }));
}

export function getServersForAgent(agentId: string): McpServerEntry[] {
  return loadServers().filter((s) => {
    if (!s.enabled) return false;
    if (s.assignedAgents.includes("*")) return true;
    return s.assignedAgents.includes(agentId);
  });
}

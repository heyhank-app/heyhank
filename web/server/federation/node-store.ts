// ─── Node Store ───────────────────────────────────────────────────────────────
// File-based CRUD for node configs. Stores identity + peer list in HEYHANK_HOME.

import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { HEYHANK_HOME } from "../paths.js";
import { atomicWriteFileSync } from "../fs-utils.js";
import type { NodeIdentity, NodeConfig } from "./node-types.js";

const IDENTITY_FILE = join(HEYHANK_HOME, "node-identity.json");
const NODES_FILE = join(HEYHANK_HOME, "nodes.json");

// ─── Node Identity ────────────────────────────────────────────────────────────

let _identity: NodeIdentity | null = null;

export function getNodeIdentity(): NodeIdentity {
  if (_identity) return _identity;
  try {
    if (existsSync(IDENTITY_FILE)) {
      const raw = JSON.parse(readFileSync(IDENTITY_FILE, "utf-8")) as Partial<NodeIdentity>;
      if (raw.nodeId && raw.name) {
        _identity = raw as NodeIdentity;
        return _identity;
      }
    }
  } catch { /* corrupted file, regenerate */ }

  _identity = {
    nodeId: randomUUID(),
    name: `Hank-${randomBytes(3).toString("hex")}`,
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dirname(IDENTITY_FILE), { recursive: true });
  atomicWriteFileSync(IDENTITY_FILE, JSON.stringify(_identity, null, 2));
  return _identity;
}

export function updateNodeName(name: string): NodeIdentity {
  const id = getNodeIdentity();
  id.name = name;
  atomicWriteFileSync(IDENTITY_FILE, JSON.stringify(id, null, 2));
  return id;
}

// ─── Node Configs ─────────────────────────────────────────────────────────────

function readNodes(): NodeConfig[] {
  try {
    if (existsSync(NODES_FILE)) {
      return JSON.parse(readFileSync(NODES_FILE, "utf-8")) as NodeConfig[];
    }
  } catch { /* corrupted */ }
  return [];
}

function writeNodes(nodes: NodeConfig[]): void {
  mkdirSync(dirname(NODES_FILE), { recursive: true });
  atomicWriteFileSync(NODES_FILE, JSON.stringify(nodes, null, 2));
}

export function listNodes(): NodeConfig[] {
  return readNodes();
}

export function getNode(id: string): NodeConfig | null {
  return readNodes().find((n) => n.id === id) ?? null;
}

export function addNode(opts: { url: string; secret: string; name: string }): NodeConfig {
  const nodes = readNodes();
  const node: NodeConfig = {
    id: randomUUID(),
    url: opts.url.replace(/\/+$/, ""),
    secret: opts.secret,
    name: opts.name || "Remote Node",
    addedAt: new Date().toISOString(),
  };
  nodes.push(node);
  writeNodes(nodes);
  return node;
}

export function removeNode(id: string): void {
  writeNodes(readNodes().filter((n) => n.id !== id));
}

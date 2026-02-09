#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Package root so the server can find dist/ regardless of CWD
const __dirname = dirname(fileURLToPath(import.meta.url));
process.env.__VIBE_PACKAGE_ROOT = resolve(__dirname, "..");

// Default to production
process.env.NODE_ENV = process.env.NODE_ENV || "production";

await import("../server/index.ts");

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { getDb } from "./db/index.js";

/**
 * Better Auth configuration for Companion Cloud.
 *
 * Uses the organization plugin with teams enabled to support:
 * - Organizations (teams): groups of users that share billing and instances
 * - Members with roles: owner, admin, member
 * - Teams within organizations for finer-grained grouping
 * - Invitations to join organizations
 *
 * Lazy singleton pattern — matches stripe.ts. The instance is created on first
 * call to getAuth() so that env vars are read at runtime (not import time),
 * which lets tests control them via vi.resetModules().
 *
 * Required env: BETTER_AUTH_SECRET
 * Optional env: BETTER_AUTH_URL (defaults to http://localhost:3458)
 */

export type Auth = ReturnType<typeof betterAuth>;

let _auth: Auth | null = null;

export function getAuth(): Auth {
  if (!_auth) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");

    _auth = betterAuth({
      secret,
      baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3458",
      trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "http://localhost:5175").split(","),
      database: drizzleAdapter(getDb(), { provider: "pg" }),
      emailAndPassword: {
        enabled: true,
      },
      plugins: [
        organization({
          teams: { enabled: true },
          allowUserToCreateOrganization: true,
          organizationLimit: 5,
          membershipLimit: 50,
          creatorRole: "owner",
        }),
      ],
    }) as unknown as Auth;
  }
  return _auth!;
}

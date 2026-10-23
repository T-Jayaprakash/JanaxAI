import fs from "node:fs";
import path from "node:path";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { emailOTP, organization } from "better-auth/plugins";
import { getConfig } from "../config";
import { sendLoginCode } from "./email";

/**
 * Accounts and workspaces (Better Auth, self-hosted: users live in our own
 * database). Sign-in is by a one-time email code, or Google when configured.
 * A workspace is a Better Auth organization: a creator, a business or an
 * agency, with members. Every project and file belongs to one.
 *
 * Local development runs without accounts (JANUX_AUTH=off, the default
 * outside production), as a single "local" workspace.
 */

export const LOCAL_WORKSPACE = "local";

export function authEnabled(): boolean {
  // A public deployment must never run without accounts.
  if (process.env.NODE_ENV === "production") return true;
  return (process.env.JANUX_AUTH ?? "off").trim() === "on";
}

function authDatabase() {
  const url = process.env.DATABASE_URL?.trim() || "";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as typeof import("pg");
    return new Pool({ connectionString: url, max: 5, ssl: /sslmode=(require|verify)/.test(url) || process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "true" } : undefined });
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  // A fresh install may reach sign-in before anything else has created the data folder.
  fs.mkdirSync(path.dirname(getConfig().dbPath), { recursive: true });
  const db = new Database(getConfig().dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
}

function authOptions() {
  const google = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } : null;
  return {
    appName: "JANUXAI",
    database: authDatabase(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    socialProviders: google ? { google } : {},
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        // Not awaited: response time must not reveal whether an email exists.
        sendVerificationOTP: async ({ email, otp, type }) => {
          void sendLoginCode(email, otp, type).catch((err) => console.error("[auth] couldn't send login code", err));
        },
      }),
      organization({
        // Anyone can start a workspace (their business or agency) and invite people.
        allowUserToCreateOrganization: true,
        organizationLimit: 10,
        sendInvitationEmail: async (data) => {
          void sendLoginCode(data.email, "", "invitation", { inviter: data.inviter.user.name || data.inviter.user.email, workspace: data.organization.name, invitationId: data.id }).catch((err) =>
            console.error("[auth] couldn't send invitation", err),
          );
        },
      }),
      nextCookies(),
    ],
  } satisfies BetterAuthOptions;
}

const buildAuth = (options: ReturnType<typeof authOptions>) => betterAuth(options);
export type Auth = ReturnType<typeof buildAuth>;

type GlobalWithAuth = typeof globalThis & { __januxAuth?: Auth; __januxAuthReady?: Promise<Auth> };

/**
 * The auth instance, created once per process after its tables exist
 * (migrations run first, so a fresh database never reports a schema mismatch).
 */
export async function authReady(): Promise<Auth> {
  const g = globalThis as GlobalWithAuth;
  if (g.__januxAuth) return g.__januxAuth;
  if (!g.__januxAuthReady) {
    if (process.env.NODE_ENV === "production" && (process.env.BETTER_AUTH_SECRET ?? "").length < 32) {
      throw new Error("BETTER_AUTH_SECRET must be set (32+ random characters) in production.");
    }
    g.__januxAuthReady = (async () => {
      const options = authOptions();
      const { getMigrations } = await import("better-auth/db/migration");
      const { runMigrations } = await getMigrations(options);
      await runMigrations();
      g.__januxAuth = buildAuth(options);
      return g.__januxAuth;
    })().catch((err) => {
      g.__januxAuthReady = undefined;
      throw err;
    });
  }
  return g.__januxAuthReady;
}

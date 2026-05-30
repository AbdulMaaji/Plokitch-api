import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET is not set in environment variables");
}

export const auth = betterAuth({
  plugins: [bearer()],
  // ── Database ──────────────────────────────────────────────
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  // ── Base URL ──────────────────────────────────────────────
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:4000",

  // ── Secret ────────────────────────────────────────────────
  secret: process.env.BETTER_AUTH_SECRET,

  // ── Trusted Origins ───────────────────────────────────────
  trustedOrigins: [
    process.env.CLIENT_ORIGIN,
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:8080",
    "http://localhost:8081",
  ].filter(Boolean) as string[],

  // ── Authentication Methods ────────────────────────────────
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true in production
    minPasswordLength: 8,
  },

  // ── User customization ────────────────────────────────────
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "customer",
        required: false,
        input: true,
      },
      phone: {
        type: "string",
        required: false,
        input: true,
      },
      isActive: {
        type: "boolean",
        defaultValue: true,
        required: false,
        input: false,
      },
      pushNotificationsEnabled: {
        type: "boolean",
        required: false,
        input: true,
      },
      marketingEmailsEnabled: {
        type: "boolean",
        required: false,
        input: true,
      }
    },
  },

  // ── Session ───────────────────────────────────────────────
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,     // refresh if older than 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },

  // ── Advanced ──────────────────────────────────────────────
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    cookiePrefix: "plotkitch",
  },
});

export type Auth = typeof auth;

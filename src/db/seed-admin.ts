import "dotenv/config";
import { eq } from "drizzle-orm";
import { auth } from "../lib/auth.js";
import { db } from "../db/index.js";
import { user } from "../db/schema.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error(
      "Set ADMIN_EMAIL and ADMIN_MASTER_KEY in your local .env before running db:seed-admin."
    );
    process.exit(1);
  }
  return value;
}

const ADMIN_EMAIL = requireEnv("ADMIN_EMAIL").toLowerCase();
const ADMIN_PASSWORD = requireEnv("ADMIN_MASTER_KEY");
const AUTH_BASE = process.env.BETTER_AUTH_URL || "http://localhost:4000";

async function seedAdmin() {
  const existing = await db.query.user.findFirst({
    where: eq(user.email, ADMIN_EMAIL),
  });

  if (existing) {
    if (existing.role !== "admin") {
      await db.update(user).set({ role: "admin" }).where(eq(user.id, existing.id));
      console.log(`Updated ${ADMIN_EMAIL} to admin role.`);
    } else {
      console.log(`Admin user already exists: ${ADMIN_EMAIL}`);
    }
    process.exit(0);
  }

  const signupReq = new Request(`${AUTH_BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      name: "Plokitch Admin",
    }),
  });

  const response = await auth.handler(signupReq);
  const bodyText = await response.text();

  if (response.status >= 400) {
    console.error("Failed to create admin user:", bodyText);
    process.exit(1);
  }

  const payload = JSON.parse(bodyText || "{}");
  const userId = payload?.user?.id;

  if (!userId) {
    console.error("Sign-up succeeded but no user id was returned.");
    process.exit(1);
  }

  await db.update(user).set({ role: "admin" }).where(eq(user.id, userId));

  console.log(`Created admin user: ${ADMIN_EMAIL}`);
  console.log("Sign in via Better Auth with the seeded email and password.");
  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error("Admin seed failed:", err);
  process.exit(1);
});

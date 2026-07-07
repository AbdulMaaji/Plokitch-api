/**
 * Schema repair for production DB drift:
 * - Migrates legacy notification columns to current schema
 * - Applies migrations 0003–0008 (skips duplicates safely)
 */
import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const MIGRATION_TAGS = [
  "0003_open_bulldozer",
  // 0004 handled separately (legacy notification table may exist)
  "0005_unique_yellowjacket",
  "0006_daily_patriot",
  "0007_magenta_ben_grimm",
  "0008_silly_namora",
];

function splitStatements(raw: string): string[] {
  return raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runStatement(stmt: string) {
  try {
    await sql.unsafe(stmt);
    console.log("  ✓", stmt.slice(0, 80).replace(/\s+/g, " ") + "…");
  } catch (err: any) {
    const code = err?.code;
    if (["42701", "42P07", "42710"].includes(code)) {
      console.log("  ⊘ skip (exists):", stmt.slice(0, 60).replace(/\s+/g, " ") + "…");
      return;
    }
    throw err;
  }
}

/** Upgrade legacy notification table (message/is_read) to current schema (body/read_at/order_id/data). */
async function migrateNotificationTable() {
  console.log("\n▶ notification table upgrade");

  const [table] = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notification'
  `;

  if (!table) {
    const raw = readFileSync(join(import.meta.dirname, "..", "drizzle", "0004_many_moon_knight.sql"), "utf8");
    for (const stmt of splitStatements(raw)) {
      await runStatement(stmt);
    }
    return;
  }

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification'
  `;
  const names = new Set(cols.map((c) => c.column_name));

  if (!names.has("body")) {
    await runStatement(`ALTER TABLE "notification" ADD COLUMN "body" text`);
    if (names.has("message")) {
      await sql.unsafe(`UPDATE "notification" SET "body" = "message" WHERE "body" IS NULL`);
      console.log("  ✓ backfilled body from message");
    }
  }

  if (!names.has("data")) {
    await runStatement(`ALTER TABLE "notification" ADD COLUMN "data" jsonb`);
  }

  if (!names.has("order_id")) {
    await runStatement(`ALTER TABLE "notification" ADD COLUMN "order_id" uuid`);
    if (names.has("entity_id") && names.has("entity_type")) {
      await sql.unsafe(`
        UPDATE "notification"
        SET "order_id" = "entity_id"::uuid
        WHERE "order_id" IS NULL
          AND "entity_type" = 'order'
          AND "entity_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      `);
      console.log("  ✓ backfilled order_id from entity_id");
    }
  }

  if (!names.has("read_at")) {
    await runStatement(`ALTER TABLE "notification" ADD COLUMN "read_at" timestamp`);
    if (names.has("is_read")) {
      await sql.unsafe(`
        UPDATE "notification"
        SET "read_at" = COALESCE("created_at", NOW())
        WHERE "is_read" = true AND "read_at" IS NULL
      `);
      console.log("  ✓ backfilled read_at from is_read");
    }
  }

  // FK on order_id if missing
  const [fk] = await sql`
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notification_order_id_order_id_fk'
  `;
  if (!fk) {
    try {
      await sql.unsafe(`
        ALTER TABLE "notification"
        ADD CONSTRAINT "notification_order_id_order_id_fk"
        FOREIGN KEY ("order_id") REFERENCES "public"."order"("id")
        ON DELETE cascade ON UPDATE no action
      `);
      console.log("  ✓ added notification.order_id FK");
    } catch (err: any) {
      if (err?.code === "42710") console.log("  ⊘ notification.order_id FK already exists");
      else throw err;
    }
  }
}

async function main() {
  const drizzleDir = join(import.meta.dirname, "..", "drizzle");

  await migrateNotificationTable();

  for (const tag of MIGRATION_TAGS) {
    const file = join(drizzleDir, `${tag}.sql`);
    console.log(`\n▶ ${tag}`);
    const raw = readFileSync(file, "utf8");
    for (const stmt of splitStatements(raw)) {
      await runStatement(stmt);
    }
  }

  console.log("\n✅ Schema repair complete");
  await sql.end();
}

main().catch((err) => {
  console.error("❌ Repair failed:", err);
  process.exit(1);
});

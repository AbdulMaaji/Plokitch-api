import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "./index.js";

async function run() {
  console.log("🚀 Creating notification table...");
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "notification" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" text NOT NULL,
        "title" text NOT NULL,
        "message" text NOT NULL,
        "type" text NOT NULL,
        "is_read" boolean DEFAULT false NOT NULL,
        "entity_type" text,
        "entity_id" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action
      );
    `);
    console.log("✅ Notification table created successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to create notification table:", error);
    process.exit(1);
  }
}

run();

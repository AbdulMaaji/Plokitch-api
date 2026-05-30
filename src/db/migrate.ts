import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index.js";

console.log("🚀 Running database migrations...");

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✅ Migrations completed successfully");
  process.exit(0);
} catch (error) {
  console.error("❌ Migration failed:", error);
  process.exit(1);
}

import "dotenv/config";
import { db } from "./index.js";
import { sql } from "drizzle-orm";

async function checkSchema() {
  try {
    const resultUser = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'user'
    `);
    console.log("User table columns:", resultUser);

    const resultAccount = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'account'
    `);
    console.log("Account table columns:", resultAccount);
  } catch (error) {
    console.error("Schema check failed:", error);
  } finally {
    process.exit(0);
  }
}

checkSchema();

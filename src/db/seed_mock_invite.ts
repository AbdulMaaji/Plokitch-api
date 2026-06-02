import "dotenv/config";
import { db } from "./index.js";
import { invite } from "./schema.js";
import crypto from "crypto";

async function run() {
  console.log("Seeding realistic invites...");
  
  const mockInvites = [
    {
      email: "chef.gordon@plokitch.com",
      role: "chef" as const,
      token: crypto.randomBytes(32).toString("hex"),
      status: "active" as const,
      expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000), // 6 days left
      createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    },
    {
      email: "rider.express@plokitch.com",
      role: "rider" as const,
      token: crypto.randomBytes(32).toString("hex"),
      status: "active" as const,
      expiresAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), // 4 days left
      createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    },
    {
      email: "chef.bocuse@plokitch.com",
      role: "chef" as const,
      token: crypto.randomBytes(32).toString("hex"),
      status: "used" as const,
      expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), 
      createdAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
      usedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    },
    {
      email: "rider.bolt@plokitch.com",
      role: "rider" as const,
      token: crypto.randomBytes(32).toString("hex"),
      status: "revoked" as const,
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
    {
      email: "chef.expired@plokitch.com",
      role: "chef" as const,
      token: crypto.randomBytes(32).toString("hex"),
      status: "active" as const,
      expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // expired 1 day ago
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    }
  ];

  for (const item of mockInvites) {
    try {
      await db.insert(invite).values(item);
      console.log(`Successfully seeded invite for ${item.email}`);
    } catch (e) {
      console.error(`Failed to seed ${item.email}:`, e);
    }
  }
  
  console.log("Mock invites seed completed!");
  process.exit(0);
}

run();

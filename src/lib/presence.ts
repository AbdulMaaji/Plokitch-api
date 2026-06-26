import { db } from "../db/index.js";
import { riderProfile } from "../db/schema.js";
import { and, eq, gt } from "drizzle-orm";

/**
 * A rider is considered truly "online" only if they are marked available AND
 * have sent a heartbeat within this window. This catches riders who lost their
 * mobile connection without being able to flip themselves offline.
 */
export const RIDER_ONLINE_WINDOW_MS = 45_000;

export function isRiderOnline(profile: {
  isAvailable: boolean;
  lastSeenAt: Date | string | null;
}): boolean {
  if (!profile.isAvailable || !profile.lastSeenAt) return false;
  const last = new Date(profile.lastSeenAt).getTime();
  return Date.now() - last < RIDER_ONLINE_WINDOW_MS;
}

/**
 * Returns the Better Auth user ids of all riders that are online right now
 * (available + fresh heartbeat). Includes both single and fleet sub-riders.
 */
export async function getOnlineRiderUserIds(): Promise<string[]> {
  const freshAfter = new Date(Date.now() - RIDER_ONLINE_WINDOW_MS);
  const rows = await db
    .select({ userId: riderProfile.userId })
    .from(riderProfile)
    .where(and(eq(riderProfile.isAvailable, true), gt(riderProfile.lastSeenAt, freshAfter)));
  return rows.map((r) => r.userId);
}

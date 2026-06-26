import { db } from "../db/index.js";
import { notification } from "../db/schema.js";

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  orderId?: string;
  data?: Record<string, unknown>;
}

/**
 * Per-user realtime channel name. The web/dashboard clients subscribe to
 * `user:<id>` and listen for the `notification` broadcast event.
 */
export function userChannel(userId: string) {
  return `user:${userId}`;
}

/**
 * Best-effort realtime broadcast via the Supabase Realtime HTTP API.
 * Uses the anon key (broadcast channels are open, same as rider-location).
 * Never throws — realtime is an enhancement on top of the persisted row.
 */
async function broadcast(topic: string, event: string, payload: unknown) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return;

  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ topic, event, payload, private: false }],
      }),
    });
  } catch (err) {
    console.warn("[notifications] broadcast failed:", (err as Error).message);
  }
}

/**
 * Persist a notification and push it in realtime to the recipient.
 * Returns the created row. Broadcast failures are swallowed.
 */
export async function notifyUser(input: NotificationInput) {
  const [row] = await db
    .insert(notification)
    .values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      orderId: input.orderId,
      data: input.data,
    })
    .returning();

  await broadcast(userChannel(input.userId), "notification", row);
  return row;
}

/** Notify several recipients with the same payload (deduped by userId). */
export async function notifyUsers(
  userIds: string[],
  input: Omit<NotificationInput, "userId">
) {
  const unique = Array.from(new Set(userIds)).filter(Boolean);
  return Promise.all(unique.map((userId) => notifyUser({ ...input, userId })));
}

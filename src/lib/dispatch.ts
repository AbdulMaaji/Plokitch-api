import { db } from "../db/index.js";
import { order } from "../db/schema.js";
import { and, eq, isNull, isNotNull, lt } from "drizzle-orm";
import { getOnlineRiderUserIds } from "./presence.js";
import { notifyUser, notifyUsers } from "./notifications.js";

/** Minutes a targeted offer is reserved for a specific rider before it expires. */
export const OFFER_WINDOW_MS = 5 * 60 * 1000;

/**
 * Broadcast an available order to every online rider (single + fleet).
 * Used for manual "Dispatch", auto-dispatch on ready, and after an offer
 * expires/declines.
 */
export async function broadcastOrderToOnlineRiders(orderRow: {
  id: string;
  deliveryFee?: string | null;
}) {
  const riderIds = await getOnlineRiderUserIds();
  if (riderIds.length === 0) return 0;

  const fee = Number(orderRow.deliveryFee ?? 0);
  await notifyUsers(riderIds, {
    type: "delivery_available",
    title: "New delivery available",
    body: fee > 0 ? `Delivery fee ₦${fee.toLocaleString()} · tap to accept` : "Tap to accept",
    orderId: orderRow.id,
    data: { kind: "broadcast" },
  });
  return riderIds.length;
}

/**
 * Create a targeted, time-boxed offer to a single rider. The order is reserved
 * (hidden from the open pool) until the offer expires or is declined.
 */
export async function offerOrderToRider(orderId: string, riderId: string) {
  const expiresAt = new Date(Date.now() + OFFER_WINDOW_MS);
  const [updated] = await db
    .update(order)
    .set({ offeredRiderId: riderId, offerExpiresAt: expiresAt, updatedAt: new Date() })
    .where(eq(order.id, orderId))
    .returning();

  if (updated) {
    await notifyUser({
      userId: riderId,
      type: "delivery_offer",
      title: "Delivery offer",
      body: "You've been offered a delivery — accept within 5 minutes.",
      orderId,
      data: { kind: "offer", expiresAt: expiresAt.toISOString() },
    });
  }
  return updated;
}

/**
 * Sweep expired offers: clear the reservation, tell the offered rider it
 * lapsed, and broadcast the order to all online riders. Returns the count
 * of orders re-broadcast. Safe to run on an interval.
 */
export async function expireStaleOffers(): Promise<number> {
  const now = new Date();
  const stale = await db
    .select()
    .from(order)
    .where(
      and(
        isNotNull(order.offeredRiderId),
        isNotNull(order.offerExpiresAt),
        lt(order.offerExpiresAt, now),
        isNull(order.riderId)
      )
    );

  for (const row of stale) {
    const previousRider = row.offeredRiderId;
    await db
      .update(order)
      .set({ offeredRiderId: null, offerExpiresAt: null, updatedAt: new Date() })
      .where(eq(order.id, row.id));

    if (previousRider) {
      await notifyUser({
        userId: previousRider,
        type: "offer_expired",
        title: "Offer expired",
        body: "A delivery offer expired and was opened to other riders.",
        orderId: row.id,
      });
    }
    // Only re-broadcast orders that are still ready for pickup.
    if (row.status === "ready") {
      await broadcastOrderToOnlineRiders(row);
    }
  }

  return stale.length;
}

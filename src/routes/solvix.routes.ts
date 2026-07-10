import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { order, vendor } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { verifyWebhookSignature, type SolvixWebhookPayload } from "../lib/solvix.js";
import { notifyUser } from "../lib/notifications.js";
import {
  sendOrderDeliveringEmail,
  sendOrderCompletedEmail,
  sendOrderCancelledEmail,
} from "../lib/email.js";

/** Map Solvix capitalized status strings to our lowercase DB enum values. */
const STATUS_MAP: Record<string, string> = {
  "Pending": "pending",
  "Assigned": "assigned",
  "Picked Up": "picked_up",
  "In Transit": "in_transit",
  "Delivered": "delivered",
  "Cancelled": "cancelled",
};

/**
 * Solvix webhook route — registered at /webhooks/solvix.
 *
 * Solvix pushes delivery status updates here. We verify the HMAC-SHA256
 * signature over the raw body, update our order records, and fire
 * notifications asynchronously.
 *
 * This route is registered as a separate plugin so we can apply a scoped
 * raw-body content-type parser (same pattern as the Paystack webhook).
 * No auth middleware — Solvix won't send our internal auth headers.
 */
export async function solvixWebhookRoutes(fastify: FastifyInstance) {
  // Scoped raw-body parser — stashes the raw string on the request for
  // HMAC verification, while still parsing JSON for the handler.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      (_req as any).rawBody = body;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  fastify.post("/webhooks/solvix", async (request, reply) => {
    const rawBody = (request as any).rawBody as string | undefined;
    const signature = request.headers["x-solvix-signature"] as string | undefined;

    if (!rawBody || !signature) {
      fastify.log.warn("Solvix webhook missing body or signature");
      return reply.status(401).send({ error: "Missing signature" });
    }

    if (!verifyWebhookSignature(rawBody, signature)) {
      fastify.log.warn("Solvix webhook signature mismatch");
      return reply.status(401).send({ error: "Invalid signature" });
    }

    const payload = request.body as SolvixWebhookPayload;
    const { deliveryId, status, riderName, timestamp } = payload;

    if (!deliveryId || !status) {
      return reply.status(200).send({ received: true });
    }

    // Look up the order by solvixDeliveryId.
    const orderRow = await db.query.order.findFirst({
      where: eq(order.solvixDeliveryId, deliveryId),
    });
    if (!orderRow) {
      fastify.log.warn({ deliveryId }, "Solvix webhook: order not found");
      return reply.status(200).send({ received: true });
    }

    // Map Solvix status to our lowercase enum.
    const mappedStatus = STATUS_MAP[status];

    // Idempotency — skip if status hasn't actually changed.
    if (orderRow.solvixStatus === mappedStatus) {
      return reply.status(200).send({ received: true });
    }

    // Update order with new Solvix status and rider info.
    const updateData: Record<string, any> = {
      solvixStatus: mappedStatus ?? orderRow.solvixStatus,
      updatedAt: new Date(),
    };
    if (riderName) {
      updateData.solvixRiderName = riderName;
    }
    if (status === "Delivered") {
      updateData.deliveredAt = new Date(timestamp || Date.now());
    }

    await db
      .update(order)
      .set(updateData)
      .where(eq(order.id, orderRow.id));

    // Fire notifications asynchronously — respond 200 immediately.
    void processSolvixStatusNotification(orderRow, mappedStatus ?? status, riderName).catch(
      (err) => fastify.log.error({ err, orderId: orderRow.id }, "Solvix notification failed")
    );

    return reply.status(200).send({ received: true });
  });
}

/**
 * Process a Solvix status update into Plokitch notifications (in-app + email).
 * Runs asynchronously after the webhook responds 200.
 */
async function processSolvixStatusNotification(
  orderRow: {
    id: string;
    customerId: string;
    vendorId: string;
    solvixRiderName?: string | null;
    [key: string]: any;
  },
  status: string,
  riderName?: string
) {
  const customerNotificationMessages: Record<string, { title: string; body: string }> = {
    assigned: {
      title: "Rider found",
      body: "A rider has been assigned to your delivery.",
    },
    picked_up: {
      title: "Order picked up",
      body: "Your order has been picked up and is on its way.",
    },
    in_transit: {
      title: "On the way",
      body: "Your order is on its way to you!",
    },
    delivered: {
      title: "Delivered",
      body: "Your order has been delivered. Enjoy!",
    },
    cancelled: {
      title: "Delivery cancelled",
      body: "Your delivery has been cancelled.",
    },
  };

  const msg = customerNotificationMessages[status];
  if (msg && orderRow.customerId) {
    await notifyUser({
      userId: orderRow.customerId,
      type: "order_status",
      title: msg.title,
      body: riderName ? `${msg.body} Rider: ${riderName}` : msg.body,
      orderId: orderRow.id,
      data: { status, solvixStatus: status, riderName },
    });
  }

  // Email notifications for key transitions (fire-and-forget).
  try {
    const orderWithRelations = await db.query.order.findFirst({
      where: eq(order.id, orderRow.id),
      with: { customer: true, vendor: true, rider: true },
    });
    if (!orderWithRelations) return;

    const vendorWithUser = await db.query.vendor.findFirst({
      where: eq(vendor.id, orderWithRelations.vendorId),
      with: { user: true },
    });

    const customerEmail = orderWithRelations.customer?.email;
    const customerName = orderWithRelations.customer?.name ?? "Customer";
    const vendorEmail = vendorWithUser?.user?.email;
    const vendorName = vendorWithUser?.businessName ?? "Vendor";

    const emailTasks: Promise<any>[] = [];

    if (status === "in_transit" && customerEmail) {
      emailTasks.push(
        sendOrderDeliveringEmail({
          order: orderWithRelations as any,
          customerName,
          customerEmail,
        })
      );
    }

    if (status === "delivered" && customerEmail && vendorEmail) {
      emailTasks.push(
        sendOrderCompletedEmail({
          order: orderWithRelations as any,
          customerName,
          customerEmail,
          vendorName,
          vendorEmail,
          riderName: riderName ?? orderRow.solvixRiderName ?? undefined,
        })
      );
    }

    if (status === "cancelled" && vendorEmail) {
      emailTasks.push(
        sendOrderCancelledEmail({
          order: orderWithRelations as any,
          vendorName,
          vendorEmail,
          riderName: riderName ?? orderRow.solvixRiderName ?? undefined,
        })
      );
    }

    if (emailTasks.length > 0) {
      void Promise.allSettled(emailTasks).then((results) => {
        results.forEach((r) => {
          if (r.status === "rejected") {
            console.error("[Solvix] Email notification failed:", r.reason);
          }
        });
      });
    }
  } catch (err) {
    console.error("[Solvix] Failed to send email notifications:", err);
  }
}

import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { order, vendor } from "../db/schema.js";
import { eq, and, or, inArray, isNull, gt, lt } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { resolveDeliveryFee } from "../lib/pricing.js";
import { notifyUser } from "../lib/notifications.js";
import { broadcastOrderToOnlineRiders } from "../lib/dispatch.js";
import { isGlobalAutoDispatchEnabled } from "../lib/settings.js";

/**
 * Order routes — /api/orders
 */
export async function orderRoutes(fastify: FastifyInstance) {
  // POST /api/orders — place a new order (customers)
  fastify.post(
    "/api/orders",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const body = request.body as {
        vendorId: string;
        items: Array<{
          menuItemId: string;
          name: string;
          price: number;
          quantity: number;
        }>;
        deliveryAddress: {
          street: string;
          city: string;
          state: string;
          instructions?: string;
        };
        deliveryZone?: string;
        notes?: string;
        isPriority?: boolean;
      };

      const itemsTotal = body.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      // Delivery fee is always recomputed server-side from the zone string —
      // any client-sent fee is ignored to prevent tampering.
      const deliveryFee = resolveDeliveryFee(body.deliveryZone);
      const totalAmount = (itemsTotal + deliveryFee).toFixed(2);

      const [newOrder] = await db
        .insert(order)
        .values({
          customerId: session.user.id,
          vendorId: body.vendorId,
          items: body.items,
          totalAmount,
          deliveryFee: deliveryFee.toFixed(2),
          deliveryAddress: body.deliveryAddress,
          notes: body.notes,
          status: "pending",
          isPriority: body.isPriority ?? false,
        })
        .returning();

      // Notify the vendor owner that a new order has arrived.
      const orderVendor = await db.query.vendor.findFirst({
        where: eq(vendor.id, body.vendorId),
      });
      if (orderVendor?.userId) {
        const itemCount = body.items.reduce((n, i) => n + i.quantity, 0);
        await notifyUser({
          userId: orderVendor.userId,
          type: "order_placed",
          title: "New order received",
          body: `${itemCount} item${itemCount === 1 ? "" : "s"} · ₦${Number(totalAmount).toLocaleString()}`,
          orderId: newOrder.id,
          data: { status: "pending" },
        });
      }

      return reply.status(201).send({ success: true, data: newOrder });
    }
  );

  // GET /api/orders/available — list orders ready for pickup (riders)
  fastify.get(
    "/api/orders/available",
    { preHandler: [requireAuth, requireRole("rider")] },
    async (request, reply) => {
      const now = new Date();
      // Open pool = ready, unassigned, and NOT currently reserved by a live
      // targeted offer to a specific rider.
      const orders = await db.query.order.findMany({
        where: and(
          eq(order.status, "ready"),
          isNull(order.riderId),
          or(isNull(order.offerExpiresAt), lt(order.offerExpiresAt, now))
        ),
        with: { customer: true, vendor: true },
        orderBy: (o, { desc }) => [desc(o.createdAt)],
      });

      return reply.send({ success: true, data: orders });
    }
  );

  // GET /api/orders — get orders (filtered by role)
  fastify.get(
    "/api/orders",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const role = (session.user as any).role ?? "customer";
      const query = request.query as { status?: string; limit?: string; offset?: string };
      const limit = parseInt(query.limit ?? "20");
      const offset = parseInt(query.offset ?? "0");

      let orders;

      if (role === "admin") {
        orders = await db.query.order.findMany({
          with: { customer: true, vendor: true, rider: true },
          limit,
          offset,
          orderBy: (o, { desc }) => [desc(o.createdAt)],
        });
      } else if (role === "customer") {
        orders = await db.query.order.findMany({
          where: eq(order.customerId, session.user.id),
          with: { vendor: true },
          limit,
          offset,
          orderBy: (o, { desc }) => [desc(o.createdAt)],
        });
      } else if (role === "chef") {
        // Get this chef's vendor first
        const myVendor = await db.query.vendor.findFirst({
          where: eq(vendor.userId, session.user.id),
        });
        if (!myVendor) {
          return reply.send({ success: true, data: [] });
        }
        orders = await db.query.order.findMany({
          where: eq(order.vendorId, myVendor.id),
          with: { customer: true },
          limit,
          offset,
          orderBy: (o, { desc }) => [desc(o.isPriority), desc(o.createdAt)],
        });
      } else if (role === "rider") {
        orders = await db.query.order.findMany({
          where: eq(order.riderId, session.user.id),
          with: { customer: true, vendor: true },
          limit,
          offset,
          orderBy: (o, { desc }) => [desc(o.createdAt)],
        });
      } else {
        return reply.status(403).send({ success: false, error: "Forbidden" });
      }

      return reply.send({ success: true, data: orders ?? [], limit, offset });
    }
  );

  // GET /api/orders/:id — get single order detail
  fastify.get(
    "/api/orders/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };

      const orderData = await db.query.order.findFirst({
        where: eq(order.id, id),
        with: { customer: true, vendor: true, rider: true },
      });

      if (!orderData) {
        return reply.status(404).send({ success: false, error: "Order not found" });
      }

      // Access control — only involved parties can see
      const userId = session.user.id;
      const role = (session.user as any).role;
      const isInvolved =
        role === "admin" ||
        orderData.customerId === userId ||
        orderData.riderId === userId;

      const chefVendor =
        role === "chef"
          ? await db.query.vendor.findFirst({
              where: eq(vendor.userId, userId),
            })
          : null;
      const isChefOwner = chefVendor?.id === orderData.vendorId;

      if (!isInvolved && !isChefOwner) {
        return reply.status(403).send({ success: false, error: "Forbidden" });
      }

      return reply.send({ success: true, data: orderData });
    }
  );

  // PATCH /api/orders/:id/status — update order status
  fastify.patch(
    "/api/orders/:id/status",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };
      const body = request.body as {
        status:
          | "confirmed"
          | "preparing"
          | "ready"
          | "picking"
          | "delivering"
          | "completed"
          | "cancelled";
        riderId?: string;
      };
 
      fastify.log.info({ id, body }, "Updating order status");

      // Constraint: Rider can only have one active delivery
      if (body.status === "picking" || body.status === "delivering") {
        const riderId = body.riderId || session.user.id;
        const activeOrder = await db.query.order.findFirst({
          where: and(
            eq(order.riderId, riderId),
            inArray(order.status, ["picking", "delivering"])
          ),
        });

        if (activeOrder && activeOrder.id !== id) {
          return reply.status(400).send({
            success: false,
            error: "You already have an active delivery. Complete it first.",
            code: "RIDER_BUSY",
          });
        }

        // A rider self-picking can't grab an order that is currently reserved by
        // a live targeted offer to someone else.
        if (body.status === "picking") {
          const target = await db.query.order.findFirst({ where: eq(order.id, id) });
          const reserved =
            target?.offeredRiderId &&
            target.offerExpiresAt &&
            new Date(target.offerExpiresAt).getTime() > Date.now() &&
            target.offeredRiderId !== riderId;
          if (reserved) {
            return reply.status(409).send({
              success: false,
              error: "This delivery is reserved for another rider right now.",
              code: "ORDER_RESERVED",
            });
          }
        }
      }

      const [updated] = await db
        .update(order)
        .set({
          status: body.status,
          ...(body.riderId && { riderId: body.riderId }),
          // Once a rider takes the order, clear any standing offer reservation.
          ...(body.status === "picking" && { offeredRiderId: null, offerExpiresAt: null }),
          ...(body.status === "completed" && { deliveredAt: new Date() }),
          updatedAt: new Date(),
        })
        .where(eq(order.id, id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ success: false, error: "Order not found" });
      }

      // Auto-dispatch: broadcast to all online riders the moment the order is
      // marked ready when EITHER global auto-dispatch is on OR this vendor has
      // its own auto-dispatch enabled.
      if (body.status === "ready" && !updated.riderId) {
        const [orderVendor, globalAuto] = await Promise.all([
          db.query.vendor.findFirst({ where: eq(vendor.id, updated.vendorId) }),
          isGlobalAutoDispatchEnabled(),
        ]);
        if (globalAuto || orderVendor?.autoDispatch) {
          await db
            .update(order)
            .set({ dispatchedAt: new Date() })
            .where(eq(order.id, updated.id));
          await broadcastOrderToOnlineRiders(updated);
        }
      }

      // Keep the customer informed in realtime as the order advances.
      const customerMessage: Record<string, string> = {
        confirmed: "Your order was confirmed by the kitchen.",
        preparing: "Your order is being prepared.",
        ready: "Your order is ready and waiting for a rider.",
        picking: "A rider is heading to the kitchen for your order.",
        delivering: "Your order is on the way!",
        completed: "Your order has been delivered. Enjoy!",
        cancelled: "Your order was cancelled.",
      };
      if (updated.customerId && customerMessage[body.status]) {
        await notifyUser({
          userId: updated.customerId,
          type: "order_status",
          title: "Order update",
          body: customerMessage[body.status],
          orderId: updated.id,
          data: { status: body.status },
        });
      }

      return reply.send({ success: true, data: updated });
    }
  );
}

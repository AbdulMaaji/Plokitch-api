import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { order, vendor } from "../db/schema.js";
import { eq, and, or, inArray, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

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
        notes?: string;
        isPriority?: boolean;
      };

      const totalAmount = body.items
        .reduce((sum, item) => sum + item.price * item.quantity, 0)
        .toFixed(2);

      const [newOrder] = await db
        .insert(order)
        .values({
          customerId: session.user.id,
          vendorId: body.vendorId,
          items: body.items,
          totalAmount,
          deliveryAddress: body.deliveryAddress,
          notes: body.notes,
          status: "pending",
          isPriority: body.isPriority ?? false,
        })
        .returning();

      return reply.status(201).send({ success: true, data: newOrder });
    }
  );

  // GET /api/orders/available — list orders ready for pickup (riders)
  fastify.get(
    "/api/orders/available",
    { preHandler: [requireAuth, requireRole("rider")] },
    async (request, reply) => {
      const orders = await db.query.order.findMany({
        where: and(eq(order.status, "ready"), isNull(order.riderId)),
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
      }

      const [updated] = await db
        .update(order)
        .set({
          status: body.status,
          ...(body.riderId && { riderId: body.riderId }),
          ...(body.status === "completed" && { deliveredAt: new Date() }),
          updatedAt: new Date(),
        })
        .where(eq(order.id, id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ success: false, error: "Order not found" });
      }

      return reply.send({ success: true, data: updated });
    }
  );
}

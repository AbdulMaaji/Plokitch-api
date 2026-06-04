import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { order, vendor, user } from "../db/schema.js";
import { eq, and, or, inArray, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { NotificationService } from "../services/notification.service.js";

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

      // Trigger notification to the Chef
      const targetVendor = await db.query.vendor.findFirst({
        where: eq(vendor.id, body.vendorId),
        with: { user: true },
      });

      if (targetVendor) {
        try {
          await NotificationService.send({
            userId: targetVendor.userId,
            title: "New Order Received",
            message: `Order #${newOrder.id.slice(0, 8)} for ₦${totalAmount} has been placed.`,
            type: "order_status",
            entityType: "order",
            entityId: newOrder.id,
            emailSubject: `[Plokitch] New Order Received - #${newOrder.id.slice(0, 8)}`,
            emailHtml: `
              <div style="font-family: sans-serif; background-color: #0A0D14; color: #E2E8F0; padding: 30px; border-radius: 12px; border: 1px solid rgba(212,175,55,0.15);">
                <h2 style="color: #D4AF37; margin-top: 0;">🍳 New Order Received</h2>
                <p>Hello Chef,</p>
                <p>A new order has been placed with your kitchen!</p>
                <div style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border-left: 4px solid #D4AF37; margin-bottom: 20px;">
                  <strong>Order ID:</strong> #${newOrder.id.slice(0, 8)}<br/>
                  <strong>Total Amount:</strong> ₦${totalAmount}<br/>
                  <strong>Notes:</strong> ${body.notes || "None"}
                </div>
                <p>Please log in to the Plokitch Dashboard to accept and prepare the order.</p>
                <div style="margin-top: 25px;">
                  <a href="https://dashboard.plokitch.app/orders/${newOrder.id}" style="display: inline-block; background-color: #D4AF37; color: #0A0D14; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Order Details</a>
                </div>
              </div>
            `
          });
        } catch (err) {
          fastify.log.error(err, "Failed to send Chef notification");
        }
      }

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

      // Fetch customer details to get their email
      const customerUser = await db.query.user.findFirst({
        where: eq(user.id, updated.customerId),
      });

      if (customerUser) {
        let title = "Order Update";
        let message = `Your order #${updated.id.slice(0, 8)} status has changed to ${body.status}.`;
        
        switch (body.status) {
          case "confirmed":
            title = "Order Confirmed";
            message = `Your order #${updated.id.slice(0, 8)} has been confirmed and is being prepared.`;
            break;
          case "preparing":
            title = "Cooking Started";
            message = `Our Chef has started preparing your order #${updated.id.slice(0, 8)}.`;
            break;
          case "ready":
            title = "Order Ready for Pickup";
            message = `Your order #${updated.id.slice(0, 8)} is ready and waiting for a rider.`;
            break;
          case "picking":
            title = "Rider Assigned";
            message = `A rider is picking up your order #${updated.id.slice(0, 8)}.`;
            break;
          case "delivering":
            title = "Out for Delivery";
            message = `Your order #${updated.id.slice(0, 8)} is on the way!`;
            break;
          case "completed":
            title = "Order Delivered";
            message = `Your order #${updated.id.slice(0, 8)} has been delivered. Enjoy your meal!`;
            break;
          case "cancelled":
            title = "Order Cancelled";
            message = `Your order #${updated.id.slice(0, 8)} has been cancelled.`;
            break;
        }

        try {
          await NotificationService.send({
            userId: updated.customerId,
            title,
            message,
            type: "order_status",
            entityType: "order",
            entityId: updated.id,
            emailSubject: `[Plokitch] Order Status Update: ${title}`,
            emailHtml: `
              <div style="font-family: sans-serif; background-color: #0A0D14; color: #E2E8F0; padding: 30px; border-radius: 12px; border: 1px solid rgba(212,175,55,0.15);">
                <h2 style="color: #D4AF37; margin-top: 0;">🍔 ${title}</h2>
                <p>Hello ${customerUser.name},</p>
                <p>${message}</p>
                <div style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 8px; border-left: 4px solid #D4AF37; margin-bottom: 20px;">
                  <strong>Order ID:</strong> #${updated.id.slice(0, 8)}<br/>
                  <strong>Status:</strong> ${body.status.toUpperCase()}<br/>
                  <strong>Updated At:</strong> ${new Date().toLocaleString()}
                </div>
                <p>Track your order status live in your Plokitch account.</p>
                <div style="margin-top: 25px;">
                  <a href="https://plokitch.app/orders/${updated.id}" style="display: inline-block; background-color: #D4AF37; color: #0A0D14; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Track Order</a>
                </div>
              </div>
            `
          });
        } catch (err) {
          fastify.log.error(err, "Failed to send customer order status update notification");
        }
      }

      // If status is "picking" or "delivering" and rider is assigned, notify rider too!
      if (updated.riderId && (body.status === "picking" || body.status === "delivering")) {
        try {
          await NotificationService.sendInApp({
            userId: updated.riderId,
            title: body.status === "picking" ? "Pickup Accepted" : "Delivery Started",
            message: body.status === "picking" 
              ? `Proceed to the kitchen to pick up order #${updated.id.slice(0, 8)}.`
              : `Deliver order #${updated.id.slice(0, 8)} to the customer's address.`,
            type: "order_status",
            entityType: "order",
            entityId: updated.id,
          });
        } catch (err) {
          fastify.log.error(err, "Failed to send rider notification");
        }
      }

      return reply.send({ success: true, data: updated });
    }
  );
}

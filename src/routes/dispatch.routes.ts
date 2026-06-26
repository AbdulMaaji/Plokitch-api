import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { order, vendor } from "../db/schema.js";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import {
  broadcastOrderToOnlineRiders,
  offerOrderToRider,
} from "../lib/dispatch.js";

/**
 * Dispatch routes — order broadcasting + targeted rider offers.
 * Mounted alongside the order routes (no prefix).
 */
export async function dispatchRoutes(fastify: FastifyInstance) {
  // Helper: confirm the requester owns the order's vendor (or is admin).
  async function assertVendorOwnerOrAdmin(
    orderId: string,
    userId: string,
    role: string | undefined
  ) {
    const target = await db.query.order.findFirst({ where: eq(order.id, orderId) });
    if (!target) return { ok: false as const, code: 404, error: "Order not found" };
    if (role === "admin") return { ok: true as const, order: target };

    const orderVendor = await db.query.vendor.findFirst({
      where: eq(vendor.id, target.vendorId),
    });
    if (!orderVendor || orderVendor.userId !== userId) {
      return { ok: false as const, code: 403, error: "Not your order" };
    }
    return { ok: true as const, order: target };
  }

  // POST /api/orders/:id/dispatch — broadcast a ready order to all online riders
  fastify.post(
    "/api/orders/:id/dispatch",
    { preHandler: [requireAuth, requireRole("chef", "admin")] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };
      const role = (session.user as any).role;

      const check = await assertVendorOwnerOrAdmin(id, session.user.id, role);
      if (!check.ok) return reply.status(check.code).send({ success: false, error: check.error });

      if (check.order.riderId) {
        return reply.status(409).send({ success: false, error: "Order already has a rider" });
      }

      await db
        .update(order)
        .set({ dispatchedAt: new Date(), offeredRiderId: null, offerExpiresAt: null, updatedAt: new Date() })
        .where(eq(order.id, id));

      const reached = await broadcastOrderToOnlineRiders(check.order);
      return reply.send({ success: true, data: { broadcastTo: reached } });
    }
  );

  // POST /api/orders/:id/assign — reserve a ready order for a specific rider (5-min offer)
  fastify.post(
    "/api/orders/:id/assign",
    { preHandler: [requireAuth, requireRole("chef", "admin")] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };
      const role = (session.user as any).role;
      const body = request.body as { riderId: string };

      if (!body?.riderId) {
        return reply.status(400).send({ success: false, error: "riderId is required" });
      }

      const check = await assertVendorOwnerOrAdmin(id, session.user.id, role);
      if (!check.ok) return reply.status(check.code).send({ success: false, error: check.error });

      if (check.order.riderId) {
        return reply.status(409).send({ success: false, error: "Order already has a rider" });
      }

      const updated = await offerOrderToRider(id, body.riderId);
      return reply.send({ success: true, data: updated });
    }
  );

  // GET /api/orders/offers/me — pending offers targeted at the current rider
  fastify.get(
    "/api/orders/offers/me",
    { preHandler: [requireAuth, requireRole("rider")] },
    async (request, reply) => {
      const session = (request as any).session;
      const now = new Date();

      const offers = await db.query.order.findMany({
        where: and(
          eq(order.offeredRiderId, session.user.id),
          gt(order.offerExpiresAt, now),
          isNull(order.riderId),
          eq(order.status, "ready")
        ),
        with: { customer: true, vendor: true },
        orderBy: (o, { desc }) => [desc(o.createdAt)],
      });

      return reply.send({ success: true, data: offers });
    }
  );

  // POST /api/orders/:id/offer/accept — rider accepts a targeted offer
  fastify.post(
    "/api/orders/:id/offer/accept",
    { preHandler: [requireAuth, requireRole("rider")] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };
      const riderId = session.user.id;

      const target = await db.query.order.findFirst({ where: eq(order.id, id) });
      if (!target) return reply.status(404).send({ success: false, error: "Order not found" });

      const valid =
        target.offeredRiderId === riderId &&
        target.offerExpiresAt &&
        new Date(target.offerExpiresAt).getTime() > Date.now() &&
        !target.riderId &&
        target.status === "ready";
      if (!valid) {
        return reply.status(409).send({ success: false, error: "Offer is no longer valid" });
      }

      // Single active delivery constraint.
      const active = await db.query.order.findFirst({
        where: and(eq(order.riderId, riderId), inArray(order.status, ["picking", "delivering"])),
      });
      if (active) {
        return reply.status(400).send({
          success: false,
          error: "You already have an active delivery. Complete it first.",
          code: "RIDER_BUSY",
        });
      }

      const [updated] = await db
        .update(order)
        .set({
          riderId,
          status: "picking",
          offeredRiderId: null,
          offerExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(order.id, id))
        .returning();

      return reply.send({ success: true, data: updated });
    }
  );

  // POST /api/orders/:id/offer/decline — rider declines; order goes to the pool
  fastify.post(
    "/api/orders/:id/offer/decline",
    { preHandler: [requireAuth, requireRole("rider")] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };
      const riderId = session.user.id;

      const target = await db.query.order.findFirst({ where: eq(order.id, id) });
      if (!target) return reply.status(404).send({ success: false, error: "Order not found" });
      if (target.offeredRiderId !== riderId) {
        return reply.status(403).send({ success: false, error: "This offer isn't yours" });
      }

      const [updated] = await db
        .update(order)
        .set({ offeredRiderId: null, offerExpiresAt: null, updatedAt: new Date() })
        .where(eq(order.id, id))
        .returning();

      if (updated?.status === "ready" && !updated.riderId) {
        await broadcastOrderToOnlineRiders(updated);
      }

      return reply.send({ success: true });
    }
  );
}

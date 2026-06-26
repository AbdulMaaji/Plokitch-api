import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { db } from "../db/index.js";
import {
  deliveryCompany,
  invite,
  order,
  riderProfile,
  user,
  vendor,
} from "../db/schema.js";
import { and, eq, gt, inArray, isNull, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { isRiderOnline } from "../lib/presence.js";
import { offerOrderToRider } from "../lib/dispatch.js";
import { sendRiderInviteEmail } from "../lib/email.js";

/** Order statuses that count as an "active" (in-flight) delivery. */
const ACTIVE_DELIVERY_STATUSES = ["confirmed", "preparing", "ready", "picking", "delivering"] as const;

/**
 * Fleet routes — registered under the /api/fleet prefix.
 * Every route here is guarded at the router level: a valid session AND the
 * "company_rider" role are required. The authenticated user is the fleet owner
 * (company operator), NOT an individual rider.
 */
export async function fleetRoutes(fastify: FastifyInstance) {
  // Router-level guards — applied to every route in this plugin.
  fastify.addHook("preHandler", requireAuth);
  fastify.addHook("preHandler", requireRole("company_rider"));

  /** Resolve the company owned by the authenticated operator, or null. */
  async function getOwnedCompany(userId: string) {
    return db.query.deliveryCompany.findFirst({
      where: eq(deliveryCompany.userId, userId),
    });
  }

  // GET /api/fleet/me — the company owned by the authenticated owner
  fastify.get("/me", async (request, reply) => {
    const userId = (request as any).session?.user?.id as string;
    const company = await getOwnedCompany(userId);

    if (!company) {
      return reply.status(404).send({ success: false, error: "No fleet company found for this account" });
    }

    return reply.send({ success: true, data: company });
  });

  // GET /api/fleet/riders — sub-riders belonging to this company (with presence)
  fastify.get("/riders", async (request, reply) => {
    const userId = (request as any).session?.user?.id as string;
    const company = await getOwnedCompany(userId);

    if (!company) {
      return reply.status(404).send({ success: false, error: "No fleet company found for this account" });
    }

    const rows = await db
      .select({
        id: riderProfile.id,
        userId: riderProfile.userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        vehicleType: riderProfile.vehicleType,
        plateNumber: riderProfile.plateNumber,
        isAvailable: riderProfile.isAvailable,
        isVerified: riderProfile.isVerified,
        applicationStatus: riderProfile.applicationStatus,
        lastSeenAt: riderProfile.lastSeenAt,
        currentLocation: riderProfile.currentLocation,
        totalDeliveries: riderProfile.totalDeliveries,
        rating: riderProfile.rating,
        createdAt: riderProfile.createdAt,
      })
      .from(riderProfile)
      .leftJoin(user, eq(riderProfile.userId, user.id))
      .where(eq(riderProfile.companyId, company.id));

    const riders = rows.map((r) => ({
      ...r,
      isOnline: isRiderOnline({ isAvailable: r.isAvailable, lastSeenAt: r.lastSeenAt }),
    }));

    return reply.send({ success: true, data: { company, riders } });
  });

  // GET /api/fleet/stats — headline counts for the fleet overview
  fastify.get("/stats", async (request, reply) => {
    const userId = (request as any).session?.user?.id as string;
    const company = await getOwnedCompany(userId);

    if (!company) {
      return reply.status(404).send({ success: false, error: "No fleet company found for this account" });
    }

    const riders = await db
      .select({
        userId: riderProfile.userId,
        isAvailable: riderProfile.isAvailable,
        lastSeenAt: riderProfile.lastSeenAt,
      })
      .from(riderProfile)
      .where(eq(riderProfile.companyId, company.id));

    const riderUserIds = riders.map((r) => r.userId);
    const onlineRiders = riders.filter((r) =>
      isRiderOnline({ isAvailable: r.isAvailable, lastSeenAt: r.lastSeenAt })
    ).length;

    let activeDeliveries = 0;
    let completedToday = 0;

    if (riderUserIds.length > 0) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const fleetOrders = await db
        .select({ status: order.status, deliveredAt: order.deliveredAt })
        .from(order)
        .where(inArray(order.riderId, riderUserIds));

      for (const o of fleetOrders) {
        if ((ACTIVE_DELIVERY_STATUSES as readonly string[]).includes(o.status)) {
          activeDeliveries++;
        }
        if (o.status === "completed" && o.deliveredAt && o.deliveredAt >= startOfDay) {
          completedToday++;
        }
      }
    }

    return reply.send({
      success: true,
      data: {
        totalRiders: riders.length,
        onlineRiders,
        activeDeliveries,
        completedToday,
        fleetSize: company.fleetSize ?? 0,
      },
    });
  });

  // GET /api/fleet/orders — active deliveries handled by this fleet's riders,
  // plus the pool of ready orders the fleet can assign to one of its riders.
  fastify.get("/orders", async (request, reply) => {
    const userId = (request as any).session?.user?.id as string;
    const company = await getOwnedCompany(userId);

    if (!company) {
      return reply.status(404).send({ success: false, error: "No fleet company found for this account" });
    }

    const riderRows = await db
      .select({ userId: riderProfile.userId, name: user.name })
      .from(riderProfile)
      .leftJoin(user, eq(riderProfile.userId, user.id))
      .where(eq(riderProfile.companyId, company.id));

    const riderUserIds = riderRows.map((r) => r.userId);
    const riderNameById = new Map(riderRows.map((r) => [r.userId, r.name]));

    // Deliveries currently or previously handled by this fleet's riders.
    const active =
      riderUserIds.length > 0
        ? await db
            .select({
              id: order.id,
              status: order.status,
              totalAmount: order.totalAmount,
              deliveryFee: order.deliveryFee,
              riderId: order.riderId,
              deliveryAddress: order.deliveryAddress,
              createdAt: order.createdAt,
              vendorName: vendor.businessName,
            })
            .from(order)
            .leftJoin(vendor, eq(order.vendorId, vendor.id))
            .where(
              and(
                inArray(order.riderId, riderUserIds),
                inArray(order.status, ACTIVE_DELIVERY_STATUSES)
              )
            )
            .orderBy(desc(order.createdAt))
        : [];

    // Open pool: ready orders with no rider and no live offer reservation.
    const now = new Date();
    const availableRaw = await db
      .select({
        id: order.id,
        status: order.status,
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee,
        deliveryAddress: order.deliveryAddress,
        offeredRiderId: order.offeredRiderId,
        offerExpiresAt: order.offerExpiresAt,
        createdAt: order.createdAt,
        vendorName: vendor.businessName,
      })
      .from(order)
      .leftJoin(vendor, eq(order.vendorId, vendor.id))
      .where(and(eq(order.status, "ready"), isNull(order.riderId)))
      .orderBy(desc(order.createdAt));

    const available = availableRaw.filter(
      (o) => !(o.offeredRiderId && o.offerExpiresAt && o.offerExpiresAt > now)
    );

    return reply.send({
      success: true,
      data: {
        active: active.map((o) => ({ ...o, riderName: o.riderId ? riderNameById.get(o.riderId) ?? null : null })),
        available,
      },
    });
  });

  // POST /api/fleet/orders/:id/assign — offer a ready order to one of the
  // fleet's own riders (5-minute targeted offer, same model as admin assign).
  fastify.post("/orders/:id/assign", async (request, reply) => {
    const userId = (request as any).session?.user?.id as string;
    const { id } = request.params as { id: string };
    const { riderId } = (request.body ?? {}) as { riderId?: string };

    if (!riderId) {
      return reply.status(400).send({ success: false, error: "riderId is required" });
    }

    const company = await getOwnedCompany(userId);
    if (!company) {
      return reply.status(404).send({ success: false, error: "No fleet company found for this account" });
    }

    // The target rider must belong to this fleet.
    const targetRider = await db.query.riderProfile.findFirst({
      where: and(eq(riderProfile.userId, riderId), eq(riderProfile.companyId, company.id)),
    });
    if (!targetRider) {
      return reply.status(403).send({ success: false, error: "Rider does not belong to your fleet" });
    }

    const targetOrder = await db.query.order.findFirst({ where: eq(order.id, id) });
    if (!targetOrder) {
      return reply.status(404).send({ success: false, error: "Order not found" });
    }
    if (targetOrder.riderId) {
      return reply.status(409).send({ success: false, error: "Order already has a rider" });
    }
    if (targetOrder.status !== "ready") {
      return reply.status(409).send({ success: false, error: "Order is not ready for dispatch" });
    }

    const updated = await offerOrderToRider(id, riderId);
    return reply.send({ success: true, data: updated });
  });

  // POST /api/fleet/riders/invite — onboard a sub-rider into this fleet.
  fastify.post("/riders/invite", async (request, reply) => {
    const userId = (request as any).session?.user?.id as string;
    const body = (request.body ?? {}) as { email?: string; name?: string };

    if (!body.email) {
      return reply.status(400).send({ success: false, error: "Email is required" });
    }

    const company = await getOwnedCompany(userId);
    if (!company) {
      return reply.status(404).send({ success: false, error: "No fleet company found for this account" });
    }

    const normalizedEmail = body.email.trim().toLowerCase();

    const existingUser = await db.query.user.findFirst({ where: eq(user.email, normalizedEmail) });
    if (existingUser) {
      return reply.status(409).send({ success: false, error: "A user with this email already exists" });
    }

    const activeInvite = await db.query.invite.findFirst({
      where: and(
        eq(invite.email, normalizedEmail),
        eq(invite.status, "active"),
        isNull(invite.usedAt),
        gt(invite.expiresAt, new Date())
      ),
    });

    const marketplaceUrl = process.env.MARKETPLACE_URL ?? "http://localhost:5173";

    if (activeInvite) {
      const inviteLink = `${marketplaceUrl}/accept-invite?token=${activeInvite.token}`;
      await sendRiderInviteEmail({
        email: normalizedEmail,
        inviteLink,
        expiresAt: activeInvite.expiresAt,
        riderType: "single",
        name: body.name,
        companyName: company.companyName,
      });
      return reply.send({ success: true, inviteLink, expiresAt: activeInvite.expiresAt.toISOString(), reused: true });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.insert(invite).values({
      email: normalizedEmail,
      role: "rider",
      token,
      status: "active",
      companyId: company.id,
      expiresAt,
    });

    const inviteLink = `${marketplaceUrl}/accept-invite?token=${token}`;
    await sendRiderInviteEmail({
      email: normalizedEmail,
      inviteLink,
      expiresAt,
      riderType: "single",
      name: body.name,
      companyName: company.companyName,
    });

    return reply.status(201).send({ success: true, inviteLink, expiresAt: expiresAt.toISOString() });
  });
}

import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { riderProfile } from "../db/schema.js";
import { and, eq, gt } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { RIDER_ONLINE_WINDOW_MS, isRiderOnline } from "../lib/presence.js";

/**
 * Rider routes — /api/riders
 */
export async function riderRoutes(fastify: FastifyInstance) {
  // GET /api/riders/me — get my rider profile
  fastify.get(
    "/api/riders/me",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;

      const profile = await db.query.riderProfile.findFirst({
        where: eq(riderProfile.userId, session.user.id),
        with: { user: true },
      });

      if (!profile) {
        return reply.status(404).send({
          success: false,
          error: "Rider profile not found",
        });
      }

      return reply.send({
        success: true,
        data: { ...profile, isOnline: isRiderOnline(profile) },
      });
    }
  );

  // POST /api/riders — create rider profile
  fastify.post(
    "/api/riders",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const body = request.body as {
        vehicleType?: string;
        plateNumber?: string;
      };

      const existing = await db.query.riderProfile.findFirst({
        where: eq(riderProfile.userId, session.user.id),
      });

      if (existing) {
        return reply.status(409).send({
          success: false,
          error: "Rider profile already exists",
        });
      }

      fastify.log.info({ userId: session.user.id }, "Creating new rider profile");
 
      const [profile] = await db
        .insert(riderProfile)
        .values({
          userId: session.user.id,
          vehicleType: body.vehicleType || "Bicycle",
          plateNumber: body.plateNumber || "N/A",
          isAvailable: true,
        })
        .returning();

      return reply.status(201).send({ success: true, data: profile });
    }
  );

  // PATCH /api/riders/me — update rider availability / location
  fastify.patch(
    "/api/riders/me",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const body = request.body as {
        isAvailable?: boolean;
        currentLocation?: { lat: number; lng: number };
        vehicleType?: string;
        plateNumber?: string;
      };

      // Going online counts as a fresh heartbeat so the rider shows up
      // immediately in availability queries.
      const stampHeartbeat = body.isAvailable === true;

      const [updated] = await db
        .update(riderProfile)
        .set({
          ...body,
          ...(stampHeartbeat ? { lastSeenAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(riderProfile.userId, session.user.id))
        .returning();

      return reply.send({
        success: true,
        data: { ...updated, isOnline: isRiderOnline(updated) },
      });
    }
  );

  // POST /api/riders/me/heartbeat — lightweight presence ping while online.
  // The rider app calls this on an interval and on reconnect so the server can
  // detect dropped mobile connections via staleness.
  fastify.post(
    "/api/riders/me/heartbeat",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const body = (request.body ?? {}) as {
        currentLocation?: { lat: number; lng: number };
      };

      const [updated] = await db
        .update(riderProfile)
        .set({
          lastSeenAt: new Date(),
          ...(body.currentLocation ? { currentLocation: body.currentLocation } : {}),
        })
        .where(eq(riderProfile.userId, session.user.id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ success: false, error: "Rider profile not found" });
      }

      return reply.send({
        success: true,
        data: { isOnline: isRiderOnline(updated), lastSeenAt: updated.lastSeenAt },
      });
    }
  );

  // GET /api/riders/available — list riders that are online right now
  // (available AND with a fresh heartbeat). Used by admin + vendor dispatch.
  fastify.get(
    "/api/riders/available",
    { preHandler: [requireAuth, requireRole("admin", "chef")] },
    async (request, reply) => {
      const freshAfter = new Date(Date.now() - RIDER_ONLINE_WINDOW_MS);
      const riders = await db.query.riderProfile.findMany({
        where: and(
          eq(riderProfile.isAvailable, true),
          gt(riderProfile.lastSeenAt, freshAfter)
        ),
        with: { user: true },
      });

      return reply.send({ success: true, data: riders });
    }
  );
}

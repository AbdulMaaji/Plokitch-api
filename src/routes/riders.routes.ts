import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { riderProfile } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

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

      return reply.send({ success: true, data: profile });
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

      const [updated] = await db
        .update(riderProfile)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(riderProfile.userId, session.user.id))
        .returning();

      return reply.send({ success: true, data: updated });
    }
  );

  // GET /api/riders/available — list available riders (admin/internal)
  fastify.get(
    "/api/riders/available",
    { preHandler: [requireAuth, requireRole("admin", "chef")] },
    async (request, reply) => {
      const riders = await db.query.riderProfile.findMany({
        where: eq(riderProfile.isAvailable, true),
        with: { user: true },
      });

      return reply.send({ success: true, data: riders });
    }
  );
}

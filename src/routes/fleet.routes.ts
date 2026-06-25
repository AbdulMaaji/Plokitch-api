import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { deliveryCompany, riderProfile, user } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

/**
 * Fleet routes — registered under the /api/fleet prefix.
 * Every route here is guarded at the router level: a valid session AND the
 * "company_rider" role are required.
 */
export async function fleetRoutes(fastify: FastifyInstance) {
  // Router-level guards — applied to every route in this plugin.
  fastify.addHook("preHandler", requireAuth);
  fastify.addHook("preHandler", requireRole("company_rider"));

  // GET /api/fleet/me — the company owned by the authenticated owner
  fastify.get("/me", async (request, reply) => {
    const userId = (request as any).session?.user?.id as string;

    const company = await db.query.deliveryCompany.findFirst({
      where: eq(deliveryCompany.userId, userId),
    });

    if (!company) {
      return reply.status(404).send({ success: false, error: "No fleet company found for this account" });
    }

    return reply.send({ success: true, data: company });
  });

  // GET /api/fleet/riders — sub-riders belonging to this company
  fastify.get("/riders", async (request, reply) => {
    const userId = (request as any).session?.user?.id as string;

    const company = await db.query.deliveryCompany.findFirst({
      where: eq(deliveryCompany.userId, userId),
    });

    if (!company) {
      return reply.status(404).send({ success: false, error: "No fleet company found for this account" });
    }

    const riders = await db
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
        createdAt: riderProfile.createdAt,
      })
      .from(riderProfile)
      .leftJoin(user, eq(riderProfile.userId, user.id))
      .where(eq(riderProfile.companyId, company.id));

    return reply.send({ success: true, data: { company, riders } });
  });
}

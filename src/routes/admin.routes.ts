import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { user, vendor, order } from "../db/schema.js";
import { eq, count, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

/**
 * Admin routes — /api/admin
 */
export async function adminRoutes(fastify: FastifyInstance) {
  // GET /api/admin/stats — platform overview stats
  fastify.get(
    "/api/admin/stats",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const [totalUsers] = await db.select({ count: count() }).from(user);
      const [totalVendors] = await db.select({ count: count() }).from(vendor);
      const [totalOrders] = await db.select({ count: count() }).from(order);
      const [completedOrders] = await db
        .select({ count: count() })
        .from(order)
        .where(eq(order.status, "completed"));

      const [revenue] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${order.totalAmount}), 0)`,
        })
        .from(order)
        .where(eq(order.status, "completed"));

      return reply.send({
        success: true,
        data: {
          users: totalUsers.count,
          vendors: totalVendors.count,
          orders: {
            total: totalOrders.count,
            completed: completedOrders.count,
          },
          revenue: revenue.total,
        },
      });
    }
  );

  // PATCH /api/admin/vendors/:id/verify — verify a vendor
  fastify.patch(
    "/api/admin/vendors/:id/verify",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { isVerified: boolean; isActive?: boolean };

      const [updated] = await db
        .update(vendor)
        .set({
          isVerified: body.isVerified,
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          updatedAt: new Date(),
        })
        .where(eq(vendor.id, id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ success: false, error: "Vendor not found" });
      }

      return reply.send({ success: true, data: updated });
    }
  );

  // PATCH /api/admin/users/:id/status — activate/deactivate a user
  fastify.patch(
    "/api/admin/users/:id/status",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { isActive: boolean };

      const [updated] = await db
        .update(user)
        .set({ isActive: body.isActive, updatedAt: new Date() })
        .where(eq(user.id, id))
        .returning({ id: user.id, email: user.email, isActive: user.isActive });

      if (!updated) {
        return reply.status(404).send({ success: false, error: "User not found" });
      }

      return reply.send({ success: true, data: updated });
    }
  );
}

import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { favoriteVendor, vendor } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.middleware.js";

/**
 * Favorites routes — /api/favorites
 */
export async function favoriteRoutes(fastify: FastifyInstance) {
  // GET /api/favorites — list current user's favorite vendors
  fastify.get(
    "/api/favorites",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      
      const favorites = await db.query.favoriteVendor.findMany({
        where: eq(favoriteVendor.userId, session.user.id),
        with: {
          vendor: true
        },
        orderBy: (f, { desc }) => [desc(f.createdAt)],
      });

      return reply.send({ 
        success: true, 
        data: favorites.map(f => f.vendor) 
      });
    }
  );

  // POST /api/favorites/:vendorId — toggle favorite status for a vendor
  fastify.post(
    "/api/favorites/:vendorId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { vendorId } = request.params as { vendorId: string };

      // 1. Check if vendor exists
      const targetVendor = await db.query.vendor.findFirst({
        where: eq(vendor.id, vendorId)
      });

      if (!targetVendor) {
        return reply.status(404).send({ success: false, error: "Vendor not found" });
      }

      // 2. Check if already favorited
      const existing = await db.query.favoriteVendor.findFirst({
        where: and(
          eq(favoriteVendor.userId, session.user.id),
          eq(favoriteVendor.vendorId, vendorId)
        )
      });

      if (existing) {
        // Unfavorite
        await db
          .delete(favoriteVendor)
          .where(
            and(
              eq(favoriteVendor.userId, session.user.id),
              eq(favoriteVendor.vendorId, vendorId)
            )
          );
        return reply.send({ success: true, favorited: false, message: "Removed from favorites" });
      } else {
        // Favorite
        await db.insert(favoriteVendor).values({
          userId: session.user.id,
          vendorId: vendorId
        });
        return reply.send({ success: true, favorited: true, message: "Added to favorites" });
      }
    }
  );
}

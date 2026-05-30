import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { user } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, getSession } from "../middleware/auth.middleware.js";

/**
 * User management routes — /api/users
 */
export async function userRoutes(fastify: FastifyInstance) {
  // GET /api/users/me — get current user's profile
  fastify.get(
    "/api/users/me",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const userData = await db.query.user.findFirst({
        where: eq(user.id, session.user.id),
        columns: {
          id: true,
          name: true,
          email: true,
          role: true,
          phone: true,
          image: true,
          address: true,
          isActive: true,
          createdAt: true,
        },
      });

      if (!userData) {
        return reply.status(404).send({ success: false, error: "User not found" });
      }

      return reply.send({ success: true, data: userData });
    }
  );

  // PATCH /api/users/me — update current user's profile
  fastify.patch(
    "/api/users/me",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const body = request.body as { 
        name?: string; 
        phone?: string; 
        image?: string;
        address?: any;
      };

      const updated = await db
        .update(user)
        .set({
          ...(body.name && { name: body.name }),
          ...(body.phone !== undefined && { phone: body.phone }),
          ...(body.image !== undefined && { image: body.image }),
          ...(body.address !== undefined && { address: body.address }),
          updatedAt: new Date(),
        })
        .where(eq(user.id, session.user.id))
        .returning({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          image: user.image,
          address: user.address,
        });

      return reply.send({ success: true, data: updated[0] });
    }
  );

  // GET /api/users — list all users (admin only)
  fastify.get(
    "/api/users",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const query = request.query as { role?: string; limit?: string; offset?: string };
      const limit = parseInt(query.limit ?? "20");
      const offset = parseInt(query.offset ?? "0");

      const users = await db.query.user.findMany({
        columns: {
          id: true,
          name: true,
          email: true,
          role: true,
          phone: true,
          isActive: true,
          createdAt: true,
        },
        limit,
        offset,
        orderBy: (u, { desc }) => [desc(u.createdAt)],
      });

      return reply.send({ success: true, data: users, limit, offset });
    }
  );
}

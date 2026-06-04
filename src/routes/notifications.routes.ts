import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { notification } from "../db/schema.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.middleware.js";

/**
 * Notifications routes — /api/notifications
 */
export async function notificationRoutes(fastify: FastifyInstance) {
  // GET /api/notifications — Fetch notifications for the authenticated user
  fastify.get(
    "/api/notifications",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { limit = "50", offset = "0" } = request.query as {
        limit?: string;
        offset?: string;
      };

      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
      const offsetNum = Math.max(0, parseInt(offset) || 0);

      const items = await db.query.notification.findMany({
        where: eq(notification.userId, session.user.id),
        orderBy: [desc(notification.createdAt)],
        limit: limitNum,
        offset: offsetNum,
      });

      return reply.send({
        success: true,
        data: items,
      });
    }
  );

  // GET /api/notifications/unread-count — Returns count of unread notifications
  fastify.get(
    "/api/notifications/unread-count",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;

      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(notification)
        .where(
          and(
            eq(notification.userId, session.user.id),
            eq(notification.isRead, false)
          )
        );

      return reply.send({
        success: true,
        data: {
          count: Number(result?.count || 0),
        },
      });
    }
  );

  // PATCH /api/notifications/:id/read — Mark a specific notification as read
  fastify.patch(
    "/api/notifications/:id/read",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };

      const [updated] = await db
        .update(notification)
        .set({ isRead: true })
        .where(
          and(
            eq(notification.id, id),
            eq(notification.userId, session.user.id)
          )
        )
        .returning();

      if (!updated) {
        return reply.status(404).send({
          success: false,
          error: "Notification not found or access denied",
        });
      }

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );

  // POST /api/notifications/read-all — Mark all notifications for the authenticated user as read
  fastify.post(
    "/api/notifications/read-all",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;

      await db
        .update(notification)
        .set({ isRead: true })
        .where(eq(notification.userId, session.user.id));

      return reply.send({
        success: true,
        message: "All notifications marked as read",
      });
    }
  );
}

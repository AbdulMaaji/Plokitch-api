import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { notification } from "../db/schema.js";
import { and, eq, isNull, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.middleware.js";
import { notifyUser } from "../lib/notifications.js";

/**
 * Notification routes — /api/notifications
 * Persisted feed + unread count. Realtime delivery is handled separately via
 * Supabase Realtime broadcast (see lib/notifications.ts).
 */
export async function notificationRoutes(fastify: FastifyInstance) {
  // GET /api/notifications — my notifications (most recent first)
  fastify.get(
    "/api/notifications",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const query = request.query as { limit?: string; unread?: string };
      const limit = Math.min(parseInt(query.limit ?? "30"), 100);

      const where =
        query.unread === "true"
          ? and(eq(notification.userId, session.user.id), isNull(notification.readAt))
          : eq(notification.userId, session.user.id);

      const rows = await db.query.notification.findMany({
        where,
        limit,
        orderBy: [desc(notification.createdAt)],
      });

      const unreadCount = await db.$count(
        notification,
        and(eq(notification.userId, session.user.id), isNull(notification.readAt))
      );

      return reply.send({ success: true, data: rows, unreadCount });
    }
  );

  // PATCH /api/notifications/:id/read — mark one as read
  fastify.patch(
    "/api/notifications/:id/read",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };

      const [updated] = await db
        .update(notification)
        .set({ readAt: new Date() })
        .where(and(eq(notification.id, id), eq(notification.userId, session.user.id)))
        .returning();

      if (!updated) {
        return reply.status(404).send({ success: false, error: "Notification not found" });
      }
      return reply.send({ success: true, data: updated });
    }
  );

  // POST /api/notifications/read-all — mark all my notifications read
  fastify.post(
    "/api/notifications/read-all",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      await db
        .update(notification)
        .set({ readAt: new Date() })
        .where(and(eq(notification.userId, session.user.id), isNull(notification.readAt)));

      return reply.send({ success: true });
    }
  );

  // POST /api/notifications — create a new notification
  fastify.post(
    "/api/notifications",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { title, message, type } = request.body as {
        title: string;
        message: string;
        type?: string;
      };

      const row = await notifyUser({
        userId: session.user.id,
        title,
        body: message,
        type: type ?? "system",
      });

      return reply.send({ success: true, data: row });
    }
  );
}

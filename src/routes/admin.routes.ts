import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import crypto from "crypto";
import { user, vendor, order, invite } from "../db/schema.js";
import { eq, count, sql, and, isNull, gt } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { sendInviteEmail } from "../lib/email.js";
import { NotificationService } from "../services/notification.service.js";

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

      // Send notification when verified
      if (body.isVerified) {
        try {
          await NotificationService.send({
            userId: updated.userId,
            title: "Chef Account Verified",
            message: `Congratulations! Your vendor profile "${updated.businessName}" has been verified. You can now receive orders.`,
            type: "onboarding",
            entityType: "vendor",
            entityId: updated.id,
            emailSubject: `[Plokitch] Your Chef Account is Verified!`,
            emailHtml: `
              <div style="font-family: sans-serif; background-color: #0A0D14; color: #E2E8F0; padding: 30px; border-radius: 12px; border: 1px solid rgba(212,175,55,0.15);">
                <h2 style="color: #D4AF37; margin-top: 0;">🎉 Account Verified!</h2>
                <p>Hello Chef,</p>
                <p>We are excited to inform you that your vendor account <strong>${updated.businessName}</strong> has been officially verified by the Plokitch administration.</p>
                <p>You can now log in, build your menu, set your hours, and start accepting customer orders!</p>
                <div style="margin-top: 25px;">
                  <a href="https://dashboard.plokitch.app" style="display: inline-block; background-color: #D4AF37; color: #0A0D14; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to Dashboard</a>
                </div>
              </div>
            `
          });
        } catch (err) {
          fastify.log.error(err, "Failed to send vendor verification notification");
        }
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

  // Helper function to create/reuse plain-token invites cleanly
  async function createInviteHelper(email: string, role: "chef" | "rider") {
    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await db.query.user.findFirst({
      where: eq(user.email, normalizedEmail),
    });

    if (existingUser) {
      throw { status: 409, error: "A user with this email address already exists", code: "CONFLICT" };
    }

    // Check if an active, unused, unexpired invite already exists
    const activeInvite = await db.query.invite.findFirst({
      where: and(
        eq(invite.email, normalizedEmail),
        eq(invite.status, "active"),
        isNull(invite.usedAt),
        gt(invite.expiresAt, new Date())
      )
    });

    const marketplaceUrl = process.env.MARKETPLACE_URL ?? "http://localhost:5173";

    if (activeInvite) {
      const inviteLink = `${marketplaceUrl}/accept-invite?token=${activeInvite.token}`;

      try {
        await sendInviteEmail({
          email: normalizedEmail,
          role: role === "chef" ? "vendor" : "rider",
          inviteLink,
          expiresAt: activeInvite.expiresAt,
        });
      } catch (emailErr) {
        console.error("Failed to dispatch active invite email:", emailErr);
      }

      return {
        success: true,
        inviteLink,
        expiresAt: activeInvite.expiresAt.toISOString(),
        reused: true,
      };
    }

    // Generate plain cryptographically secure hex token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(invite).values({
      email: normalizedEmail,
      role,
      token,
      status: "active",
      expiresAt,
    });

    const inviteLink = `${marketplaceUrl}/accept-invite?token=${token}`;

    try {
      await sendInviteEmail({
        email: normalizedEmail,
        role: role === "chef" ? "vendor" : "rider",
        inviteLink,
        expiresAt,
      });
    } catch (emailErr) {
      console.error("Failed to dispatch new invite email:", emailErr);
    }

    return {
      success: true,
      inviteLink,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // POST /api/admin/vendors/invite — legacy vendor invite wrapper
  fastify.post(
    "/api/admin/vendors/invite",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const body = request.body as { email: string };
      if (!body.email) {
        return reply.status(400).send({ success: false, error: "Email is required" });
      }
      try {
        const result = await createInviteHelper(body.email, "chef");
        return reply.status(result.reused ? 200 : 201).send(result);
      } catch (err: any) {
        if (err.status) return reply.status(err.status).send({ success: false, error: err.error, code: err.code });
        return reply.status(500).send({ success: false, error: err.message || "Internal server error" });
      }
    }
  );

  // POST /api/admin/riders/invite — legacy rider invite wrapper
  fastify.post(
    "/api/admin/riders/invite",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const body = request.body as { email: string };
      if (!body.email) {
        return reply.status(400).send({ success: false, error: "Email is required" });
      }
      try {
        const result = await createInviteHelper(body.email, "rider");
        return reply.status(result.reused ? 200 : 201).send(result);
      } catch (err: any) {
        if (err.status) return reply.status(err.status).send({ success: false, error: err.error, code: err.code });
        return reply.status(500).send({ success: false, error: err.message || "Internal server error" });
      }
    }
  );

  // GET /api/admin/invites — list all invites & dynamic computed stats
  fastify.get(
    "/api/admin/invites",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const invitesList = await db.query.invite.findMany();
      invitesList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const now = new Date();
      let total = 0;
      let active = 0;
      let used = 0;
      let expired = 0;
      let revoked = 0;

      for (const item of invitesList) {
        total++;
        if (item.status === "used") {
          used++;
        } else if (item.status === "revoked") {
          revoked++;
        } else if (item.expiresAt < now) {
          expired++;
        } else {
          active++;
        }
      }

      return reply.send({
        success: true,
        data: {
          invites: invitesList,
          stats: { total, active, used, expired, revoked },
        },
      });
    }
  );

  // POST /api/admin/invites — unified create endpoint
  fastify.post(
    "/api/admin/invites",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const body = request.body as { email: string; role: "chef" | "rider" };
      if (!body.email || !body.role) {
        return reply.status(400).send({ success: false, error: "Email and role are required fields" });
      }
      if (body.role !== "chef" && body.role !== "rider") {
        return reply.status(400).send({ success: false, error: "Role must be chef or rider" });
      }

      try {
        const result = await createInviteHelper(body.email, body.role);
        return reply.status(result.reused ? 200 : 201).send(result);
      } catch (err: any) {
        if (err.status) return reply.status(err.status).send({ success: false, error: err.error, code: err.code });
        return reply.status(500).send({ success: false, error: err.message || "Internal server error" });
      }
    }
  );

  // POST /api/admin/invites/:id/revoke — revoke an invitation link
  fastify.post(
    "/api/admin/invites/:id/revoke",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!id) {
        return reply.status(400).send({ success: false, error: "Invite ID is required" });
      }

      await db
        .update(invite)
        .set({ status: "revoked" })
        .where(eq(invite.id, id));

      return reply.send({ success: true, message: "Invitation successfully revoked" });
    }
  );
}

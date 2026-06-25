import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import crypto from "crypto";
import { user, vendor, order, invite, joinApplication } from "../db/schema.js";
import { eq, count, sql, and, isNull, gt, or, ilike, desc, type SQL } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { sendInviteEmail, sendRiderInviteEmail, sendRejectionEmail } from "../lib/email.js";

/** Optional metadata used to personalise & branch invite emails. */
interface RiderInviteOptions {
  name?: string;
  riderType?: "single" | "company";
  companyName?: string;
}

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

  // Dispatches the correct onboarding email for the operator role.
  // Vendors get the generic partner invite; riders get the dedicated rider
  // invite (single vs. company/fleet). Email failures are logged everywhere and
  // re-thrown in production so they are never silently swallowed.
  async function dispatchOnboardingEmail(
    normalizedEmail: string,
    role: "chef" | "rider" | "company",
    inviteLink: string,
    expiresAt: Date,
    opts: RiderInviteOptions
  ) {
    try {
      if (role === "company") {
        await sendRiderInviteEmail({
          email: normalizedEmail,
          inviteLink,
          expiresAt,
          riderType: "company",
          name: opts.name,
          companyName: opts.companyName,
        });
      } else if (role === "rider") {
        await sendRiderInviteEmail({
          email: normalizedEmail,
          inviteLink,
          expiresAt,
          riderType: opts.riderType ?? "single",
          name: opts.name,
          companyName: opts.companyName,
        });
      } else {
        await sendInviteEmail({
          email: normalizedEmail,
          role: "vendor",
          inviteLink,
          expiresAt,
          name: opts.name,
        });
      }
    } catch (emailErr) {
      console.error(`Failed to dispatch ${role} invite email to ${normalizedEmail}:`, emailErr);
      if (process.env.NODE_ENV === "production") {
        throw emailErr;
      }
    }
  }

  // Helper function to create/reuse plain-token invites cleanly.
  // `executor` lets callers run this inside a transaction (defaults to the
  // shared db connection).
  async function createInviteHelper(
    email: string,
    role: "chef" | "rider" | "company",
    opts: RiderInviteOptions = {},
    executor: typeof db = db
  ) {
    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await executor.query.user.findFirst({
      where: eq(user.email, normalizedEmail),
    });

    if (existingUser) {
      throw { status: 409, error: "A user with this email address already exists", code: "CONFLICT" };
    }

    // Check if an active, unused, unexpired invite already exists
    const activeInvite = await executor.query.invite.findFirst({
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

      await dispatchOnboardingEmail(normalizedEmail, role, inviteLink, activeInvite.expiresAt, opts);

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

    await executor.insert(invite).values({
      email: normalizedEmail,
      role,
      token,
      status: "active",
      expiresAt,
    });

    const inviteLink = `${marketplaceUrl}/accept-invite?token=${token}`;

    await dispatchOnboardingEmail(normalizedEmail, role, inviteLink, expiresAt, opts);

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
      const body = request.body as {
        email: string;
        name?: string;
        riderType?: "single" | "company";
        companyName?: string;
      };
      if (!body.email) {
        return reply.status(400).send({ success: false, error: "Email is required" });
      }
      try {
        const result = await createInviteHelper(body.email, "rider", {
          name: body.name,
          riderType: body.riderType ?? "single",
          companyName: body.companyName,
        });
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
      const body = request.body as {
        email: string;
        role: "chef" | "rider";
        name?: string;
        riderType?: "single" | "company";
        companyName?: string;
      };
      if (!body.email || !body.role) {
        return reply.status(400).send({ success: false, error: "Email and role are required fields" });
      }
      if (body.role !== "chef" && body.role !== "rider") {
        return reply.status(400).send({ success: false, error: "Role must be chef or rider" });
      }

      try {
        const result = await createInviteHelper(body.email, body.role, {
          name: body.name,
          riderType: body.role === "rider" ? body.riderType ?? "single" : undefined,
          companyName: body.companyName,
        });
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

  // GET /api/admin/applications — list "Join Us" applications with filters
  fastify.get(
    "/api/admin/applications",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { type, status, search } = request.query as {
        type?: string;
        status?: string;
        search?: string;
      };

      const validTypes = ["vendor", "home_chef", "single_rider", "delivery_company"];
      const validStatuses = ["pending", "approved", "rejected"];

      const conditions: SQL[] = [];

      if (type && type !== "all") {
        if (!validTypes.includes(type)) {
          return reply.status(400).send({ success: false, error: "Invalid type filter" });
        }
        conditions.push(eq(joinApplication.applicantType, type as any));
      }

      if (status && status !== "all") {
        if (!validStatuses.includes(status)) {
          return reply.status(400).send({ success: false, error: "Invalid status filter" });
        }
        conditions.push(eq(joinApplication.applicationStatus, status as any));
      }

      if (search && search.trim()) {
        const term = `%${search.trim()}%`;
        const searchCond = or(
          ilike(joinApplication.contactName, term),
          ilike(joinApplication.contactEmail, term),
          ilike(joinApplication.businessName, term),
          ilike(joinApplication.contactPhone, term)
        );
        if (searchCond) conditions.push(searchCond);
      }

      const applications = await db
        .select()
        .from(joinApplication)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(joinApplication.createdAt));

      return reply.send({ success: true, data: applications });
    }
  );

  // GET /api/admin/applications/:id — single application
  fastify.get(
    "/api/admin/applications/:id",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const application = await db.query.joinApplication.findFirst({
        where: eq(joinApplication.id, id),
      });

      if (!application) {
        return reply.status(404).send({ success: false, error: "Application not found" });
      }

      return reply.send({ success: true, data: application });
    }
  );

  // PATCH /api/admin/applications/:id/approve — approve & trigger onboarding invite
  fastify.patch(
    "/api/admin/applications/:id/approve",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const adminId = (request as any).session?.user?.id ?? null;

      const application = await db.query.joinApplication.findFirst({
        where: eq(joinApplication.id, id),
      });

      if (!application) {
        return reply.status(404).send({ success: false, error: "Application not found" });
      }

      if (
        application.applicationStatus === "approved" ||
        application.applicationStatus === "rejected"
      ) {
        return reply.status(409).send({ success: false, error: "Application already reviewed." });
      }

      try {
        // Atomic: mark reviewed + create the onboarding invite together. The
        // invite (and its email) is created inside createInviteHelper, threaded
        // with the transaction executor so a failure rolls everything back.
        // The actual operator account + profile (vendor / rider / deliveryCompany)
        // is created later, when the invitee accepts the invite and sets a password.
        await db.transaction(async (tx) => {
          await tx
            .update(joinApplication)
            .set({
              applicationStatus: "approved",
              reviewedAt: new Date(),
              reviewedBy: adminId,
            })
            .where(eq(joinApplication.id, id));

          const txDb = tx as unknown as typeof db;

          switch (application.applicantType) {
            case "vendor":
            case "home_chef":
              await createInviteHelper(
                application.contactEmail,
                "chef",
                { name: application.contactName },
                txDb
              );
              break;

            case "single_rider":
              await createInviteHelper(
                application.contactEmail,
                "rider",
                { name: application.contactName, riderType: "single" },
                txDb
              );
              break;

            case "delivery_company":
              await createInviteHelper(
                application.contactEmail,
                "company",
                {
                  name: application.contactName,
                  riderType: "company",
                  companyName: application.businessName ?? application.contactName,
                },
                txDb
              );
              break;

            default:
              throw new Error(`Unsupported applicant type: ${application.applicantType}`);
          }
        });
      } catch (err: any) {
        fastify.log.error(err, "Application approval failed");
        // Surface a genuine client conflict (e.g. user already exists) rather than masking it.
        if (err?.status === 409) {
          return reply.status(409).send({ success: false, error: err.error, code: err.code });
        }
        return reply.status(500).send({ success: false, error: "Approval failed. No changes made." });
      }

      return reply.send({
        success: true,
        message: `Approved. Invite sent to ${application.contactEmail}.`,
      });
    }
  );

  // PATCH /api/admin/applications/:id/reject — reject with optional reason
  fastify.patch(
    "/api/admin/applications/:id/reject",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reason } = (request.body as { reason?: string }) ?? {};
      const adminId = (request as any).session?.user?.id ?? null;

      const application = await db.query.joinApplication.findFirst({
        where: eq(joinApplication.id, id),
      });

      if (!application) {
        return reply.status(404).send({ success: false, error: "Application not found" });
      }

      if (
        application.applicationStatus === "approved" ||
        application.applicationStatus === "rejected"
      ) {
        return reply.status(409).send({ success: false, error: "Application already reviewed." });
      }

      try {
        await db
          .update(joinApplication)
          .set({
            applicationStatus: "rejected",
            rejectionReason: reason ?? null,
            reviewedAt: new Date(),
            reviewedBy: adminId,
          })
          .where(eq(joinApplication.id, id));

        // Mirror dispatchOnboardingEmail policy: log always, throw in production.
        try {
          await sendRejectionEmail({
            name: application.contactName,
            email: application.contactEmail,
            reason,
          });
        } catch (emailErr) {
          fastify.log.error(emailErr, "Failed to dispatch rejection email");
          if (process.env.NODE_ENV === "production") throw emailErr;
        }
      } catch (err: any) {
        fastify.log.error(err, "Application rejection failed");
        return reply.status(500).send({ success: false, error: "Rejection failed." });
      }

      return reply.send({ success: true, message: "Application rejected." });
    }
  );
}

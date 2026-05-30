import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { vendor, menuItem, order } from "../db/schema.js";
import { eq, or, sql, count } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

/**
 * Vendor (Kitchen) routes — /api/vendors
 */
export async function vendorRoutes(fastify: FastifyInstance) {
  // GET /api/vendors — list all active vendors (public)
  fastify.get("/api/vendors", async (request, reply) => {
    const query = request.query as {
      limit?: string;
      offset?: string;
      cuisine?: string;
    };
    const limit = parseInt(query.limit ?? "20");
    const offset = parseInt(query.offset ?? "0");

    const vendors = await db
      .select({
        vendor,
        totalOrders: count(order.id),
      })
      .from(vendor)
      .leftJoin(order, eq(vendor.id, order.vendorId))
      .where(eq(vendor.isActive, true))
      .groupBy(vendor.id)
      .limit(limit)
      .offset(offset)
      .orderBy(sql`${vendor.rating} DESC`);

    // Fetch related data for each vendor (drizzle query builder style doesn't support complex aggregations easily in one go)
    const vendorsWithData = await Promise.all(
      vendors.map(async (v) => {
        const fullVendor = await db.query.vendor.findFirst({
          where: eq(vendor.id, v.vendor.id),
          with: {
            user: { columns: { name: true, image: true } },
            menuItems: { where: eq(menuItem.isAvailable, true) },
          },
        });
        return { ...fullVendor, totalOrders: Number(v.totalOrders) };
      })
    );

    return reply.send({ success: true, data: vendorsWithData, limit, offset });
  });

  // GET /api/vendors/me — get current user's kitchen profile
  fastify.get(
    "/api/vendors/me",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const vendorData = await db.query.vendor.findFirst({
        where: eq(vendor.userId, session.user.id),
        with: {
          menuItems: true,
        },
      });

      if (!vendorData) {
        return reply.status(404).send({
          success: false,
          error: "You haven't set up a kitchen yet",
          code: "NOT_FOUND",
        });
      }

      return reply.send({ success: true, data: vendorData });
    }
  );

  // GET /api/vendors/:id — get single vendor with menu (public, supports ID or slug)
  fastify.get("/api/vendors/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    // Check if it's a UUID or a slug
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const vendorData = await db.query.vendor.findFirst({
      where: isUuid ? eq(vendor.id, id) : eq(vendor.slug, id),
      with: {
        user: {
          columns: {
            name: true,
            image: true,
          }
        },
        menuItems: {
          where: eq(menuItem.isAvailable, true),
          orderBy: (m, { desc }) => [desc(m.isFeatured), desc(m.rating)],
        },
      },
    });

    if (!vendorData) {
      return reply.status(404).send({
        success: false,
        error: "Kitchen not found",
        code: "NOT_FOUND",
      });
    }

    // Get order count
    const [orderCount] = await db
      .select({ value: count() })
      .from(order)
      .where(eq(order.vendorId, vendorData.id));

    return reply.send({ 
      success: true, 
      data: { 
        ...vendorData, 
        totalOrders: Number(orderCount.value) 
      } 
    });
  });

  // POST /api/vendors — create vendor profile (chef role)
  fastify.post(
    "/api/vendors",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const body = request.body as {
        businessName: string;
        description?: string;
        cuisineType?: string;
        specialty?: string;
        location?: {
          address: string;
          city: string;
          state: string;
          lat?: number;
          lng?: number;
        };
        deliveryTime?: string;
        imageUrl?: string;
        isActive?: boolean;
      };

      // Check if vendor already exists for this user
      const existing = await db.query.vendor.findFirst({
        where: eq(vendor.userId, session.user.id),
      });

      if (existing) {
        return reply.status(409).send({
          success: false,
          error: "You already have a kitchen profile",
          code: "CONFLICT",
        });
      }

      const slug = body.businessName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const [newVendor] = await db
        .insert(vendor)
        .values({
          userId: session.user.id,
          businessName: body.businessName,
          slug,
          description: body.description,
          cuisineType: body.cuisineType,
          specialty: body.specialty,
          location: body.location,
          deliveryTime: body.deliveryTime ?? "30-45 min",
          imageUrl: body.imageUrl,
          isActive: body.isActive ?? false,
        })
        .returning();

      return reply.status(201).send({ success: true, data: newVendor });
    }
  );

  // PATCH /api/vendors/:id — update vendor profile (owner or admin)
  fastify.patch(
    "/api/vendors/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };
      const body = request.body as Partial<{
        businessName: string;
        description: string;
        cuisineType: string;
        specialty: string;
        tag: string;
        imageUrl: string;
        bannerUrl: string;
        location: object;
        deliveryTime: string;
        minOrder: string;
        isActive: boolean;
      }>;

      // Verify ownership
      const vendorData = await db.query.vendor.findFirst({
        where: eq(vendor.id, id),
      });

      if (!vendorData) {
        return reply.status(404).send({ success: false, error: "Kitchen not found" });
      }

      const isOwner = vendorData.userId === session.user.id;
      const isAdmin = (session.user as any).role === "admin";

      if (!isOwner && !isAdmin) {
        return reply.status(403).send({
          success: false,
          error: "Forbidden",
          code: "FORBIDDEN",
        });
      }

      let updateData = { ...(body as any), updatedAt: new Date() };
      
      if (body.businessName) {
        updateData.slug = body.businessName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
      }

      const [updated] = await db
        .update(vendor)
        .set(updateData)
        .where(eq(vendor.id, id))
        .returning();

      return reply.send({ success: true, data: updated });
    }
  );

  // ── Menu Item sub-routes ────────────────────────────────

  // GET /api/vendors/:id/menu — get all menu items for a vendor
  fastify.get("/api/vendors/:id/menu", async (request, reply) => {
    const { id } = request.params as { id: string };

    const items = await db.query.menuItem.findMany({
      where: eq(menuItem.vendorId, id),
      orderBy: (m, { desc }) => [desc(m.isFeatured), desc(m.rating)],
    });

    return reply.send({ success: true, data: items });
  });

  // POST /api/vendors/:id/menu — add menu item (chef owner only)
  fastify.post(
    "/api/vendors/:id/menu",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };
      const body = request.body as {
        name: string;
        description?: string;
        price: string;
        category?: "mains" | "sides" | "desserts" | "drinks" | "starters" | "specials";
        imageUrl?: string;
        ingredients?: string[];
        prepTime?: string;
        tag?: string;
      };

      // Verify ownership
      const vendorData = await db.query.vendor.findFirst({
        where: eq(vendor.id, id),
      });

      if (!vendorData || vendorData.userId !== session.user.id) {
        return reply.status(403).send({
          success: false,
          error: "Forbidden",
          code: "FORBIDDEN",
        });
      }

      const [newItem] = await db
        .insert(menuItem)
        .values({
          vendorId: id,
          name: body.name,
          description: body.description,
          price: body.price,
          category: body.category ?? "mains",
          imageUrl: body.imageUrl,
          ingredients: body.ingredients ?? [],
          prepTime: body.prepTime,
          tag: body.tag,
        })
        .returning();

      return reply.status(201).send({ success: true, data: newItem });
    }
  );

  // PATCH /api/vendors/:vendorId/menu/:itemId — update menu item
  fastify.patch(
    "/api/vendors/:vendorId/menu/:itemId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { vendorId, itemId } = request.params as {
        vendorId: string;
        itemId: string;
      };
      const body = request.body as Partial<{
        name: string;
        description: string;
        price: string;
        category: string;
        imageUrl: string;
        ingredients: string[];
        prepTime: string;
        tag: string;
        isAvailable: boolean;
        isFeatured: boolean;
      }>;

      const vendorData = await db.query.vendor.findFirst({
        where: eq(vendor.id, vendorId),
      });

      if (!vendorData || vendorData.userId !== session.user.id) {
        return reply.status(403).send({ success: false, error: "Forbidden" });
      }

      const [updated] = await db
        .update(menuItem)
        .set({ ...(body as any), updatedAt: new Date() })
        .where(eq(menuItem.id, itemId))
        .returning();

      return reply.send({ success: true, data: updated });
    }
  );

  // DELETE /api/vendors/:vendorId/menu/:itemId — remove menu item
  fastify.delete(
    "/api/vendors/:vendorId/menu/:itemId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { vendorId, itemId } = request.params as {
        vendorId: string;
        itemId: string;
      };

      const vendorData = await db.query.vendor.findFirst({
        where: eq(vendor.id, vendorId),
      });

      if (!vendorData || vendorData.userId !== session.user.id) {
        return reply.status(403).send({ success: false, error: "Forbidden" });
      }

      await db.delete(menuItem).where(eq(menuItem.id, itemId));
      return reply.send({ success: true, message: "Menu item deleted" });
    }
  );
}

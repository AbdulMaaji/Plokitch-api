import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { vendor, menuItem, order, review } from "../db/schema.js";
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
      .orderBy(sql`${vendor.rating} DESC`)
      .limit(limit)
      .offset(offset);

    // Fetch related data for each vendor (drizzle query builder style doesn't support complex aggregations easily in one go)
    const vendorsWithData = await Promise.all(
      vendors.map(async (v) => {
        const fullVendor = await db.query.vendor.findFirst({
          where: eq(vendor.id, v.vendor.id),
          with: {
            user: { columns: { name: true, image: true, email: true, phone: true } },
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
          user: {
            columns: {
              name: true,
              image: true,
              email: true,
              phone: true,
            }
          },
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
            email: true,
            phone: true,
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

  // GET /api/vendors/:id/reviews — get reviews for a vendor (public)
  fastify.get("/api/vendors/:id/reviews", async (request, reply) => {
    const { id } = request.params as { id: string };
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let vendorId = id;

    if (!isUuid) {
      const v = await db.query.vendor.findFirst({
        where: eq(vendor.slug, id),
        columns: { id: true },
      });
      if (!v) {
        return reply.status(404).send({ success: false, error: "Kitchen not found" });
      }
      vendorId = v.id;
    }

    const reviewsData = await db.query.review.findMany({
      where: eq(review.vendorId, vendorId),
      with: {
        customer: {
          columns: {
            name: true,
            image: true,
          },
        },
      },
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });

    return reply.send({ success: true, data: reviewsData });
  });

  // POST /api/vendors/:id/reviews — create a review (authenticated)
  fastify.post(
    "/api/vendors/:id/reviews",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };
      const body = request.body as {
        rating: number;
        comment?: string;
        orderId?: string;
      };

      if (!body.rating || body.rating < 1 || body.rating > 5) {
        return reply.status(400).send({ success: false, error: "Rating must be between 1 and 5" });
      }

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      let vendorId = id;

      if (!isUuid) {
        const v = await db.query.vendor.findFirst({
          where: eq(vendor.slug, id),
          columns: { id: true },
        });
        if (!v) {
          return reply.status(404).send({ success: false, error: "Kitchen not found" });
        }
        vendorId = v.id;
      }

      const [newReview] = await db
        .insert(review)
        .values({
          customerId: session.user.id,
          vendorId,
          orderId: body.orderId || null,
          rating: body.rating,
          comment: body.comment,
        })
        .returning();

      // Recalculate average rating for vendor
      const allReviews = await db
        .select({ rating: review.rating })
        .from(review)
        .where(eq(review.vendorId, vendorId));

      if (allReviews.length > 0) {
        const total = allReviews.reduce((sum, r) => sum + r.rating, 0);
        const avg = total / allReviews.length;
        await db
          .update(vendor)
          .set({ rating: avg.toFixed(2) })
          .where(eq(vendor.id, vendorId));
      }

      return reply.status(201).send({ success: true, data: newReview });
    }
  );

  // PUT /api/vendors/reviews/:reviewId — update a review (authenticated)
  fastify.put(
    "/api/vendors/reviews/:reviewId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { reviewId } = request.params as { reviewId: string };
      const body = request.body as {
        rating: number;
        comment?: string;
      };

      if (!body.rating || body.rating < 1 || body.rating > 5) {
        return reply.status(400).send({ success: false, error: "Rating must be between 1 and 5" });
      }

      const existingReview = await db.query.review.findFirst({
        where: eq(review.id, reviewId),
      });

      if (!existingReview) {
        return reply.status(404).send({ success: false, error: "Review not found" });
      }

      if (existingReview.customerId !== session.user.id) {
        return reply.status(403).send({ success: false, error: "You can only edit your own reviews" });
      }

      const [updatedReview] = await db
        .update(review)
        .set({
          rating: body.rating,
          comment: body.comment,
        })
        .where(eq(review.id, reviewId))
        .returning();

      // Recalculate average rating for vendor
      const vendorId = existingReview.vendorId;
      const allReviews = await db
        .select({ rating: review.rating })
        .from(review)
        .where(eq(review.vendorId, vendorId));

      if (allReviews.length > 0) {
        const total = allReviews.reduce((sum, r) => sum + r.rating, 0);
        const avg = total / allReviews.length;
        await db
          .update(vendor)
          .set({ rating: avg.toFixed(2) })
          .where(eq(vendor.id, vendorId));
      }

      return reply.send({ success: true, data: updatedReview });
    }
  );

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
        autoDispatch: boolean;
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

      const allowedFields = [
        "businessName",
        "description",
        "cuisineType",
        "specialty",
        "tag",
        "imageUrl",
        "bannerUrl",
        "location",
        "deliveryTime",
        "minOrder",
        "isActive",
        "autoDispatch",
      ];

      if (isAdmin) {
        allowedFields.push("isVerified", "commissionRate", "rating");
      }

      const updateData: Record<string, any> = {};
      for (const field of allowedFields) {
        if ((body as any)[field] !== undefined) {
          updateData[field] = (body as any)[field];
        }
      }

      updateData.updatedAt = new Date();
      
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

  // POST /api/vendors/:id/image — upload a single kitchen image
  fastify.post(
    "/api/vendors/:id/image",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { id } = request.params as { id: string };

      const vendorData = await db.query.vendor.findFirst({ where: eq(vendor.id, id) });
      if (!vendorData || vendorData.userId !== session.user.id) {
        return reply.status(403).send({ success: false, error: "Forbidden" });
      }

      try {
        const filesIter = (request as any).files ? (request as any).files() : null;
        if (!filesIter) {
          return reply.status(400).send({ success: false, error: "No file provided" });
        }

        let publicUrl = "";
        async function streamToBuffer(stream: any) {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return Buffer.concat(chunks);
        }

        for await (const part of filesIter) {
          if (!part || !part.filename) continue;
          const buffer = part.toBuffer ? await part.toBuffer() : await streamToBuffer(part.file);
          const path = `kitchens/${id}/${Date.now()}_${part.filename}`;
          const { supabase } = await import("../lib/supabase.js");
          const { error: uploadErr } = await supabase.storage.from("kitchens").upload(path, buffer, {
            contentType: part.mimetype || "application/octet-stream",
            upsert: false,
          });
          if (uploadErr) {
            request.log.error({ err: uploadErr }, "Supabase upload failed");
            return reply.status(500).send({ success: false, error: "Could not upload image." });
          }
          publicUrl = supabase.storage.from("kitchens").getPublicUrl(path).data.publicUrl;
          break;
        }

        if (!publicUrl) {
          return reply.status(400).send({ success: false, error: "No image uploaded" });
        }

        const [updated] = await db
          .update(vendor)
          .set({ imageUrl: publicUrl, updatedAt: new Date() })
          .where(eq(vendor.id, id))
          .returning();

        return reply.send({ success: true, data: updated });
      } catch (err) {
        request.log.error(err, "Vendor image upload error");
        return reply.status(500).send({ success: false, error: "Could not upload image." });
      }
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
        imageUrls?: string[];
        ingredients?: string[];
        prepTime?: string;
        tag?: string;
        isAvailable?: boolean;
        isAddOn?: boolean;
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
          imageUrls: body.imageUrls ?? [],
          ingredients: body.ingredients ?? [],
          prepTime: body.prepTime,
          tag: body.tag,
          isAvailable: body.isAvailable ?? true,
          isAddOn: body.isAddOn ?? false,
        })
        .returning();

      return reply.status(201).send({ success: true, data: newItem });
    }
  );

  // POST /api/vendors/:vendorId/menu/:itemId/images — upload one or more images
  fastify.post(
    "/api/vendors/:vendorId/menu/:itemId/images",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const { vendorId, itemId } = request.params as { vendorId: string; itemId: string };

      // Verify ownership
      const vendorData = await db.query.vendor.findFirst({ where: eq(vendor.id, vendorId) });
      if (!vendorData || vendorData.userId !== session.user.id) {
        return reply.status(403).send({ success: false, error: "Forbidden" });
      }

      // Ensure item exists
      const targetItem = await db.query.menuItem.findFirst({ where: eq(menuItem.id, itemId) });
      if (!targetItem) return reply.status(404).send({ success: false, error: "Menu item not found" });

      // Accept multipart files
      try {
        const uploadedUrls: string[] = [];
        // helper to read stream to buffer
        async function streamToBuffer(stream: any) {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return Buffer.concat(chunks);
        }

        // `request.files()` is an async iterator provided by @fastify/multipart
        const filesIter = (request as any).files ? (request as any).files() : null;
        if (!filesIter) {
          return reply.status(400).send({ success: false, error: "No files provided" });
        }

        for await (const part of filesIter) {
          // part has: filename, mimetype, file (stream)
          if (!part || !part.filename) continue;
          const buffer = part.toBuffer ? await part.toBuffer() : await streamToBuffer(part.file);
          const path = `dishes/${vendorId}/${itemId}/${Date.now()}_${part.filename}`;
          const { supabase } = await import("../lib/supabase.js");
          const { error: uploadErr } = await supabase.storage.from("dishes").upload(path, buffer, {
            contentType: part.mimetype || "application/octet-stream",
            upsert: false,
          });
          if (uploadErr) {
            request.log.error({ err: uploadErr }, "Supabase upload failed");
            return reply.status(500).send({ success: false, error: "Could not upload images. Try again later." });
          }

          const publicUrl = supabase.storage.from("dishes").getPublicUrl(path).data.publicUrl;
          if (publicUrl) uploadedUrls.push(publicUrl);
        }

        if (uploadedUrls.length === 0) {
          return reply.status(400).send({ success: false, error: "No images uploaded" });
        }

        // Persist URLs to menu item image_urls column (append)
        const existing = targetItem.imageUrls ?? [];
        const newUrls = existing.concat(uploadedUrls);
        const [updated] = await db.update(menuItem).set({ imageUrls: newUrls, updatedAt: new Date() }).where(eq(menuItem.id, itemId)).returning();

        return reply.send({ success: true, data: updated });
      } catch (err) {
        request.log.error(err, "Image upload error");
        return reply.status(500).send({ success: false, error: "Could not upload images. Try again later." });
      }
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
        imageUrls: string[];
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

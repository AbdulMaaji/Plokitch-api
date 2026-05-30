import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { order, vendor, riderProfile } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.middleware.js";

/**
 * Location routes — /api/location
 * Provides aggregated coordinate data for map views
 */
export async function locationRoutes(fastify: FastifyInstance) {
  // GET /api/location/order/:orderId
  // Returns all map coordinates for an order (kitchen, rider, destination)
  fastify.get(
    "/api/location/order/:orderId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };

      // Handle mock/demo IDs for development
      if (orderId.startsWith("demo-")) {
        return reply.send({
          success: true,
          data: {
            orderId,
            status: "preparing",
            kitchen: { lat: 51.5074, lng: -0.1278 }, // Mock London coordinates
            rider: { lat: 51.5174, lng: -0.1378 },
            delivery: { lat: 51.4974, lng: -0.1178 },
            riderInfo: { name: "Demo Rider", image: null },
            items: [{ name: "Artisan Burger", quantity: 2 }],
            totalAmount: "25.00"
          }
        });
      }

      // Validate UUID to prevent Postgres 500 errors
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
      if (!isUuid) {
        return reply.status(404).send({ success: false, error: "Invalid order ID format" });
      }

      const orderData = await db.query.order.findFirst({
        where: eq(order.id, orderId),
        with: {
          vendor: true,
        },
      });

      if (!orderData) {
        return reply.status(404).send({
          success: false,
          error: "Order not found",
        });
      }

      // Get rider's current location and name if a rider is assigned
      let riderLocation: { lat: number; lng: number } | null = null;
      let riderInfo: { name: string | null; image: string | null } | null = null;
      
      if (orderData.riderId) {
        const rider = await db.query.riderProfile.findFirst({
          where: eq(riderProfile.userId, orderData.riderId),
          with: {
            user: {
              columns: {
                name: true,
                image: true,
              }
            }
          }
        });
        if (rider?.currentLocation) {
          riderLocation = rider.currentLocation;
        }
        riderInfo = {
          name: rider?.user?.name || null,
          image: rider?.user?.image || null,
        };
      }

      // Kitchen location from vendor
      const kitchenLocation = orderData.vendor?.location
        ? {
            lat: orderData.vendor.location.lat ?? null,
            lng: orderData.vendor.location.lng ?? null,
          }
        : null;

      // Delivery location from order
      const deliveryLocation =
        orderData.deliveryLat && orderData.deliveryLng
          ? {
              lat: parseFloat(orderData.deliveryLat),
              lng: parseFloat(orderData.deliveryLng),
            }
          : orderData.deliveryAddress?.lat && orderData.deliveryAddress?.lng
          ? {
              lat: orderData.deliveryAddress.lat,
              lng: orderData.deliveryAddress.lng,
            }
          : null;

      return reply.send({
        success: true,
        data: {
          orderId,
          status: orderData.status,
          kitchen: kitchenLocation,
          rider: riderLocation,
          delivery: deliveryLocation,
          riderId: orderData.riderId,
          riderInfo,
          items: orderData.items || [],
          totalAmount: orderData.totalAmount || "0",
        },
      });
    }
  );

  // POST /api/location/rider/ping
  // Rider pings their current position (rate-limited DB write)
  fastify.post(
    "/api/location/rider/ping",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = (request as any).session;
      const body = request.body as {
        lat: number;
        lng: number;
      };

      if (!body.lat || !body.lng) {
        return reply.status(400).send({
          success: false,
          error: "lat and lng are required",
        });
      }

      const [updated] = await db
        .update(riderProfile)
        .set({
          currentLocation: { lat: body.lat, lng: body.lng },
          updatedAt: new Date(),
        })
        .where(eq(riderProfile.userId, session.user.id))
        .returning();

      if (!updated) {
        return reply.status(404).send({
          success: false,
          error: "Rider profile not found",
        });
      }

      return reply.send({ success: true, data: { lat: body.lat, lng: body.lng } });
    }
  );
}

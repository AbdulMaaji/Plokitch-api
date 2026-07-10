import "dotenv/config";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifySensible from "@fastify/sensible";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";

import { authRoutes } from "./routes/auth.routes.js";
import { userRoutes } from "./routes/users.routes.js";
import { vendorRoutes } from "./routes/vendors.routes.js";
import { orderRoutes } from "./routes/orders.routes.js";
import { riderRoutes } from "./routes/riders.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";
import { applicationRoutes } from "./routes/applications.routes.js";
import { contactRoutes } from "./routes/contact.routes.js";
import { paymentRoutes } from "./routes/payments.routes.js";
import { fleetRoutes } from "./routes/fleet.routes.js";
import { locationRoutes } from "./routes/location.routes.js";
import { favoriteRoutes } from "./routes/favorites.routes.js";
import { notificationRoutes } from "./routes/notifications.routes.js";
import { dispatchRoutes } from "./routes/dispatch.routes.js";
import { walletRoutes } from "./routes/wallet.routes.js";
import { expireStaleOffers } from "./lib/dispatch.js";
import { errorHandler } from "./middleware/error.middleware.js";

const PORT = parseInt(process.env.PORT ?? "4000");
const HOST = process.env.HOST ?? "0.0.0.0";

// ──────────────────────────────────────────────────────────────
// Create Fastify instance
// ──────────────────────────────────────────────────────────────
const fastify = Fastify({
  logger: {
    transport:
      process.env.NODE_ENV !== "production"
        ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
        }
        : undefined,
  },
  // Do NOT use body parser on auth routes (better-auth parses its own body)
  bodyLimit: 10 * 1024 * 1024, // 10 MB
});

// ──────────────────────────────────────────────────────────────
// Plugins
// NOTE: Hardened production security: Helmet & Rate-Limiting active
// ──────────────────────────────────────────────────────────────
await fastify.register(fastifySensible);
await fastify.register(fastifyHelmet, {
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
});
await fastify.register(fastifyRateLimit, {
  max: 120,
  timeWindow: "1 minute",
});

await fastify.register(fastifyCors, {
  origin: (origin, cb) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      cb(null, true);
      return;
    }

    try {
      // Split and clean client origins from process.env.CLIENT_ORIGIN
      const configuredOrigins = process.env.CLIENT_ORIGIN
        ? process.env.CLIENT_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
        : [];

      const allowedOrigins = [
        ...configuredOrigins,
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
        "http://localhost:8080",
        "http://localhost:8081",
      ];

      // Direct exact match
      if (allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }

      // Allow Vercel preview environments (*.vercel.app)
      if (/\.vercel\.app$/i.test(origin)) {
        cb(null, true);
        return;
      }

      const parsedUrl = new URL(origin);
      // Allow localhost and loopback interface connections
      if (
        parsedUrl.hostname === "localhost" ||
        parsedUrl.hostname === "127.0.0.1"
      ) {
        cb(null, true);
        return;
      }
    } catch (err) {
      // Catch invalid URLs to prevent server crashing
      fastify.log.error(err, "CORS origin parsing error");
    }

    cb(new Error("Not allowed by CORS"), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Cookie",
    "x-better-auth-session",
    "x-admin-active-role",
  ],
  exposedHeaders: ["set-cookie"],
  credentials: true,
  maxAge: 86400,
});

// ──────────────────────────────────────────────────────────────
// Error handler
// ──────────────────────────────────────────────────────────────
fastify.setErrorHandler(errorHandler);

// ──────────────────────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────────────────────
fastify.get("/health", async () => ({
  status: "ok",
  service: "plokitch-api",
  timestamp: new Date().toISOString(),
  env: process.env.NODE_ENV ?? "development",
}));

// ──────────────────────────────────────────────────────────────
// Routes
// NOTE: Auth routes MUST be registered before body parser middleware
// so Better Auth can handle its own body parsing.
// ──────────────────────────────────────────────────────────────
await fastify.register(authRoutes);
await fastify.register(userRoutes);
await fastify.register(vendorRoutes);
await fastify.register(orderRoutes);
await fastify.register(riderRoutes);
await fastify.register(adminRoutes);
await fastify.register(applicationRoutes);
await fastify.register(contactRoutes);
// Payment routes register their own scoped raw-body parser (for Paystack
// webhook signature verification), so other routes are unaffected.
await fastify.register(paymentRoutes, { prefix: "/api/payments" });
await fastify.register(fleetRoutes, { prefix: "/api/fleet" });
await fastify.register(locationRoutes);
await fastify.register(favoriteRoutes);
await fastify.register(notificationRoutes);
await fastify.register(dispatchRoutes);
await fastify.register(walletRoutes);

// ──────────────────────────────────────────────────────────────
// 404 handler
// ──────────────────────────────────────────────────────────────
fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    success: false,
    error: `Route ${request.method} ${request.url} not found`,
    code: "NOT_FOUND",
  });
});

// ──────────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────────
try {
  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`🍳 Plokitch API running on http://${HOST}:${PORT}`);
  fastify.log.info(`🔐 Auth endpoint: http://${HOST}:${PORT}/api/auth`);
  fastify.log.info(`❤️  Health check: http://${HOST}:${PORT}/health`);

  // Dispatch sweeper: expire stale targeted offers and re-broadcast to the
  // open pool. Runs every 30s.
  const dispatchSweeper = setInterval(() => {
    expireStaleOffers().catch((err) =>
      fastify.log.error({ err }, "Offer expiry sweep failed")
    );
  }, 30_000);
  dispatchSweeper.unref?.();
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

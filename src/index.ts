import "dotenv/config";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifySensible from "@fastify/sensible";

import { authRoutes } from "./routes/auth.routes.js";
import { userRoutes } from "./routes/users.routes.js";
import { vendorRoutes } from "./routes/vendors.routes.js";
import { orderRoutes } from "./routes/orders.routes.js";
import { riderRoutes } from "./routes/riders.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";
import { locationRoutes } from "./routes/location.routes.js";
import { favoriteRoutes } from "./routes/favorites.routes.js";
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
// ──────────────────────────────────────────────────────────────
await fastify.register(fastifySensible);

await fastify.register(fastifyCors, {
  origin: (origin, cb) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      cb(null, true);
      return;
    }

    const allowedOrigins = [
      process.env.CLIENT_ORIGIN,
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:8080",
      "http://localhost:8081",
    ].filter(Boolean);

    const hostname = new URL(origin).hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || allowedOrigins.includes(origin)) {
      cb(null, true);
      return;
    }

    cb(new Error("Not allowed by CORS"), false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Cookie",
    "x-better-auth-session"
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
  service: "plotkitch-api",
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
await fastify.register(locationRoutes);
await fastify.register(favoriteRoutes);

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
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

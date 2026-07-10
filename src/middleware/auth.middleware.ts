import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Helper to get the authenticated session from any Fastify route.
 */
export async function getSession(request: FastifyRequest) {
  return auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
}

/**
 * Fastify preHandler that enforces authentication.
 * Attach it to any route that requires a logged-in user.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Check for internal secret key
  const internalSecret = request.headers["x-internal-secret"];
  if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    (request as any).session = {
      user: {
        // Synthetic proxy has no real user row, so id is null to avoid
        // violating FK columns (e.g. reviewedBy) when handlers persist it.
        id: null,
        role: "admin",
        email: "admin@plokitch.app",
        name: "Internal Admin Proxy",
      },
      session: {
        id: "internal-session",
      }
    };
    return;
  }

  const session = await getSession(request);
  if (!session) {
    return reply.status(401).send({
      success: false,
      error: "Unauthorized — please log in",
      code: "UNAUTHORIZED",
    });
  }
  
  // If the authenticated user is an admin, allow overriding the active role via header or cookie
  const user = session.user as any;
  if (user && user.role === "admin") {
    let activeRole = request.headers["x-admin-active-role"] as string | undefined;

    if (!activeRole && request.headers.cookie) {
      const match = request.headers.cookie.match(/admin_active_role=([^;\s]+)/);
      if (match) {
        activeRole = match[1];
      }
    }

    if (activeRole === "customer" || activeRole === "chef" || activeRole === "rider") {
      const overriddenUser = { ...session.user, role: activeRole };
      (request as any).session = {
        ...session,
        user: overriddenUser,
      };
    } else {
      (request as any).session = session;
    }
  } else {
    // Attach to request for downstream handlers
    (request as any).session = session;
  }
}

/**
 * Fastify preHandler that enforces a specific role.
 * Always combine with requireAuth first.
 */
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const session = (request as any).session as Awaited<
      ReturnType<typeof getSession>
    >;

    if (!session) {
      return reply.status(401).send({
        success: false,
        error: "Unauthorized",
        code: "UNAUTHORIZED",
      });
    }

    const userRole = (session.user as any).role ?? "customer";
    if (!roles.includes(userRole)) {
      return reply.status(403).send({
        success: false,
        error: `Forbidden — requires role: ${roles.join(" or ")}`,
        code: "FORBIDDEN",
      });
    }
  };
}

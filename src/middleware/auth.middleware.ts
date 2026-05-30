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
  const session = await getSession(request);
  if (!session) {
    return reply.status(401).send({
      success: false,
      error: "Unauthorized — please log in",
      code: "UNAUTHORIZED",
    });
  }
  // Attach to request for downstream handlers
  (request as any).session = session;
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

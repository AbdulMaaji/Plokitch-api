import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";

/**
 * Auth routes — Better Auth handler catch-all.
 * All /api/auth/* requests are forwarded to Better Auth.
 */
export async function authRoutes(fastify: FastifyInstance) {
  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      try {
        const url = new URL(
          request.url,
          `${request.protocol}://${request.headers.host}`
        );

        const headers = fromNodeHeaders(request.headers);
        // Important: Remove content-length as the new Request will calculate its own from the stringified body
        headers.delete("content-length");

        const req = new Request(url.toString(), {
          method: request.method,
          headers,
          ...(request.body
            ? { body: JSON.stringify(request.body) }
            : {}),
        });

        const response = await auth.handler(req);

        reply.status(response.status);
        response.headers.forEach((value: string, key: string) => {
          reply.header(key, value);
        });

        const body = await response.text();

        if (response.status >= 400) {
          fastify.log.warn({ status: response.status, body }, "Auth handler error response");
        }

        return reply.send(body || null);
      } catch (error) {
        fastify.log.error(error, "CRITICAL Auth handler error");
        return reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Internal authentication error",
          code: "AUTH_FAILURE",
        });
      }
    },
  });
}

import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Global error handler for consistent error responses.
 */
export function errorHandler(
  error: Error & { statusCode?: number; validation?: unknown },
  request: FastifyRequest,
  reply: FastifyReply
) {
  const statusCode = error.statusCode ?? 500;

  request.log.error({
    err: error,
    req: { method: request.method, url: request.url },
  });

  // Validation errors (Fastify schema)
  if (error.validation) {
    return reply.status(400).send({
      success: false,
      error: "Validation failed",
      details: error.validation,
      code: "VALIDATION_ERROR",
    });
  }

  const message =
    process.env.NODE_ENV === "production" && statusCode === 500
      ? "Internal Server Error"
      : error.message;

  return reply.status(statusCode).send({
    success: false,
    error: message,
    code: statusCode === 404 ? "NOT_FOUND" : "SERVER_ERROR",
  });
}

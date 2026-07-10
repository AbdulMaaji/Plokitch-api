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

  // Friendly messages for common failure modes.
  // Avoid exposing raw DB or stack details to clients.
  let clientMessage = "Something went wrong. Please try again.";

  // Database connection / network issues
  const lower = (error.message || "").toLowerCase();
  if (lower.includes("connect") || lower.includes("econnrefused") || lower.includes("timeout")) {
    clientMessage = "Temporary database connection issue. Please try again later.";
  } else if (statusCode === 404) {
    clientMessage = "Not found.";
  } else if (statusCode === 403) {
    clientMessage = "Forbidden.";
  } else if (statusCode === 400) {
    clientMessage = "Bad request.";
  }

  // Log full error server-side; send simple messages to client.
  return reply.status(statusCode).send({
    success: false,
    error: clientMessage,
    code: statusCode === 404 ? "NOT_FOUND" : statusCode === 400 ? "BAD_REQUEST" : "SERVER_ERROR",
  });
}

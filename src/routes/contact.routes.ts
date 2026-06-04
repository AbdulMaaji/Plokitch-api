import type { FastifyInstance } from "fastify";
import { sendJoinApplicationEmail } from "../lib/email.js";

/**
 * Contact / Public form routes — /api/contact
 */
export async function contactRoutes(fastify: FastifyInstance) {
  // POST /api/contact/join — public join application form (chef or rider)
  fastify.post("/api/contact/join", async (request, reply) => {
    const body = request.body as {
      fullName: string;
      email: string;
      phone: string;
      role: "chef" | "rider";
      message?: string;
      location?: string;
    };

    // Basic validation
    if (!body.fullName || !body.email || !body.phone || !body.role) {
      return reply.status(400).send({
        success: false,
        error: "Full name, email, phone, and role are required.",
        code: "VALIDATION_ERROR",
      });
    }

    if (!["chef", "rider"].includes(body.role)) {
      return reply.status(400).send({
        success: false,
        error: "Role must be either 'chef' or 'rider'.",
        code: "VALIDATION_ERROR",
      });
    }

    try {
      await sendJoinApplicationEmail({
        fullName: body.fullName,
        email: body.email,
        phone: body.phone,
        role: body.role,
        message: body.message,
        location: body.location,
      });

      return reply.send({
        success: true,
        message: "Your application has been submitted successfully! We'll review it and get back to you soon.",
      });
    } catch (error: any) {
      request.log.error(error, "Failed to send join application email");
      return reply.status(500).send({
        success: false,
        error: "Failed to submit application. Please try again later.",
        code: "SERVER_ERROR",
      });
    }
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendContactMessage } from "../lib/email.js";

const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("A valid email is required"),
  subject: z.string().trim().min(1, "Subject is required"),
  message: z.string().trim().min(1, "Message is required").max(5000, "Message is too long"),
});

/**
 * Public contact route — /api/contact
 * No authentication required (public Contact page submissions).
 * Emails the platform inbox via Resend.
 */
export async function contactRoutes(fastify: FastifyInstance) {
  fastify.post("/api/contact", async (request, reply) => {
    const parsed = contactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid contact payload",
        code: "VALIDATION_ERROR",
      });
    }

    const data = parsed.data;

    try {
      await sendContactMessage({
        name: data.name,
        email: data.email.toLowerCase(),
        subject: data.subject,
        message: data.message,
      });
    } catch (err) {
      fastify.log.error(err, "Failed to send contact message");
      // In production a failed dispatch should surface as an error so the
      // sender knows to try another channel.
      if (process.env.NODE_ENV === "production") {
        return reply.status(502).send({
          success: false,
          error: "We couldn't send your message right now. Please email support@plokitch.app.",
        });
      }
    }

    return reply.status(201).send({
      success: true,
      message: "Message received. We'll be in touch within 24 hours.",
    });
  });
}

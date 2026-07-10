import type { FastifyInstance } from "fastify";
import {
  sendWelcomeEmail,
  sendOrderReceiptEmail,
  sendNewOrderVendorEmail,
  sendOrderDeliveringEmail,
  sendOrderCompletedEmail,
  sendOrderCancelledEmail,
} from "../lib/email.js";

/**
 * Compatibility endpoint for mobile clients that expect
 * POST /api/notifications/email with a simple action + payload.
 *
 * Body shape:
 * {
 *   action: "welcome" | "order_receipt" | "new_order_vendor" | "order_delivering" | "order_completed" | "order_cancelled",
 *   payload: { ... }
 * }
 */
export async function notificationEmailRoutes(fastify: FastifyInstance) {
  fastify.post("/api/notifications/email", async (request, reply) => {
    const body = request.body as any;
    const action: string = body?.action;
    const payload = body?.payload ?? {};

    try {
      switch (action) {
        case "welcome":
          // payload: { email, name? }
          await sendWelcomeEmail({ email: payload.email, name: payload.name });
          break;

        case "order_receipt":
          // payload: { order, customerName, customerEmail, vendorName }
          await sendOrderReceiptEmail({
            order: payload.order,
            customerName: payload.customerName,
            customerEmail: payload.customerEmail,
            vendorName: payload.vendorName,
          });
          break;

        case "new_order_vendor":
          // payload: { order, vendorEmail, vendorName, customerName }
          await sendNewOrderVendorEmail({
            order: payload.order,
            vendorEmail: payload.vendorEmail,
            vendorName: payload.vendorName,
            customerName: payload.customerName,
          });
          break;

        case "order_delivering":
          // payload: { order, customerName, customerEmail }
          await sendOrderDeliveringEmail({
            order: payload.order,
            customerName: payload.customerName,
            customerEmail: payload.customerEmail,
          });
          break;

        case "order_completed":
          // payload: { order, customerName, customerEmail, vendorName, vendorEmail, riderName?, riderEmail? }
          await sendOrderCompletedEmail({
            order: payload.order,
            customerName: payload.customerName,
            customerEmail: payload.customerEmail,
            vendorName: payload.vendorName,
            vendorEmail: payload.vendorEmail,
            riderName: payload.riderName,
            riderEmail: payload.riderEmail,
          });
          break;

        case "order_cancelled":
          // payload: { order, vendorName, vendorEmail, riderName?, riderEmail? }
          await sendOrderCancelledEmail({
            order: payload.order,
            vendorName: payload.vendorName,
            vendorEmail: payload.vendorEmail,
            riderName: payload.riderName,
            riderEmail: payload.riderEmail,
          });
          break;

        default:
          return reply.status(400).send({ success: false, error: "Unknown action" });
      }

      return reply.send({ success: true });
    } catch (err) {
      fastify.log.error(err, "compatibility email proxy failed");
      return reply.status(500).send({ success: false, error: "Email dispatch failed" });
    }
  });
}

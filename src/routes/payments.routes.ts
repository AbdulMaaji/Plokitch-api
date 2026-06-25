import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { db } from "../db/index.js";
import { order } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.middleware.js";

const PAYSTACK_BASE = "https://api.paystack.co";

/**
 * Payment routes — registered under the /api/payments prefix.
 *
 * The Paystack webhook needs the *raw* request body to verify the HMAC
 * signature. Fastify's default JSON parser discards it, so we register a
 * scoped content-type parser here that stashes the raw string on the request.
 * Because this parser is added inside this (encapsulated) plugin, it only
 * affects payment routes — other routes keep the default parser untouched.
 */
export async function paymentRoutes(fastify: FastifyInstance) {
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      (_req as any).rawBody = body;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // ── POST /api/payments/initialize ───────────────────────────
  fastify.post(
    "/initialize",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (!secret) {
        fastify.log.error("PAYSTACK_SECRET_KEY is not configured");
        return reply
          .status(500)
          .send({ success: false, error: "Payment provider is not configured" });
      }

      const session = (request as any).session;
      const { orderId } = (request.body as { orderId?: string }) ?? {};
      if (!orderId) {
        return reply.status(400).send({ success: false, error: "orderId is required" });
      }

      const existing = await db.query.order.findFirst({
        where: eq(order.id, orderId),
      });

      if (!existing) {
        return reply.status(404).send({ success: false, error: "Order not found" });
      }
      if (existing.customerId !== session.user.id) {
        return reply.status(403).send({ success: false, error: "Forbidden" });
      }
      if (existing.paymentStatus === "paid") {
        return reply.status(409).send({ success: false, error: "Order is already paid" });
      }

      const reference = crypto.randomUUID();
      const amountKobo = Math.round(Number(existing.totalAmount) * 100);
      const marketplaceUrl = process.env.MARKETPLACE_URL || "http://localhost:3000";

      let psPayload: any;
      try {
        const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: session.user.email,
            amount: amountKobo,
            reference,
            metadata: {
              orderId: existing.id,
              customerId: session.user.id,
            },
            callback_url: `${marketplaceUrl}/customer/orders/${existing.id}`,
          }),
        });
        psPayload = await res.json();
        if (!res.ok || !psPayload?.status || !psPayload?.data?.authorization_url) {
          fastify.log.error({ psPayload }, "Paystack initialize failed");
          return reply.status(502).send({
            success: false,
            error: psPayload?.message || "Failed to initialize payment",
          });
        }
      } catch (err) {
        fastify.log.error(err, "Paystack initialize request error");
        return reply
          .status(502)
          .send({ success: false, error: "Failed to reach payment provider" });
      }

      await db
        .update(order)
        .set({
          paymentRef: reference,
          paymentStatus: "pending",
          updatedAt: new Date(),
        })
        .where(eq(order.id, existing.id));

      return reply.send({
        success: true,
        authorizationUrl: psPayload.data.authorization_url,
        reference: psPayload.data.reference ?? reference,
      });
    }
  );

  // ── POST /api/payments/webhook ──────────────────────────────
  // No auth — Paystack calls this directly. Authenticity is proven by the
  // x-paystack-signature HMAC over the raw request body.
  fastify.post("/webhook", async (request, reply) => {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      fastify.log.error("PAYSTACK_SECRET_KEY is not configured");
      return reply.status(500).send({ error: "Payment provider is not configured" });
    }

    const rawBody = (request as any).rawBody as string | undefined;
    const signature = request.headers["x-paystack-signature"] as string | undefined;

    if (!rawBody || !signature) {
      return reply.status(401).send({ error: "Missing signature" });
    }

    const hash = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
    if (hash !== signature) {
      fastify.log.warn("Paystack webhook signature mismatch");
      return reply.status(401).send({ error: "Invalid signature" });
    }

    const event = request.body as {
      event?: string;
      data?: { reference?: string; metadata?: { orderId?: string } };
    };

    // Only act on successful charges; acknowledge everything else.
    if (event?.event !== "charge.success") {
      return reply.status(200).send({ received: true });
    }

    const reference = event.data?.reference;
    const orderId = event.data?.metadata?.orderId;
    if (!reference || !orderId) {
      return reply.status(200).send({ received: true });
    }

    // Idempotency — if we've already marked this order paid, ack and stop.
    const existing = await db.query.order.findFirst({ where: eq(order.id, orderId) });
    if (!existing) {
      return reply.status(200).send({ received: true });
    }
    if (existing.paymentStatus === "paid") {
      return reply.status(200).send({ received: true });
    }

    // Never trust the webhook alone — verify the transaction with Paystack.
    try {
      const verifyRes = await fetch(`${PAYSTACK_BASE}/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const verifyData: any = await verifyRes.json();
      if (!verifyRes.ok || verifyData?.data?.status !== "success") {
        fastify.log.warn({ reference }, "Paystack verify did not confirm success");
        return reply.status(200).send({ received: true });
      }
    } catch (err) {
      fastify.log.error(err, "Paystack verify error");
      // Acknowledge (avoid retry storms); reconciliation can recover this later.
      return reply.status(200).send({ received: true });
    }

    await db
      .update(order)
      .set({
        paymentStatus: "paid",
        status: "confirmed",
        paymentRef: reference,
        updatedAt: new Date(),
      })
      .where(eq(order.id, orderId));

    return reply.status(200).send({ received: true });
  });
}

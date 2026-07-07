import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { db } from "../db/index.js";
import { wallet, ledgerEntry, transferRecipient, payout, user } from "../db/schema.js";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import { getOrCreateWallet, debitWallet, creditWallet } from "../lib/wallet.js";
import { notifyUser } from "../lib/notifications.js";
import {
  isPaystackConfigured,
  listBanks,
  resolveAccountName,
  createTransferRecipient,
  initiateTransfer,
  FALLBACK_BANKS,
} from "../lib/paystack.js";

/**
 * Wallet routes — /api/wallet. Available to any authenticated earner
 * (rider, chef/vendor, fleet owner). Customers simply have an empty wallet.
 */
export async function walletRoutes(fastify: FastifyInstance) {
  // GET /api/wallet/me — balance + lifetime + this-week summary
  fastify.get("/api/wallet/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).session.user.id as string;
    const w = await getOrCreateWallet(userId);

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [weekRow] = await db
      .select({ total: sql<string>`coalesce(sum(${ledgerEntry.amount}), 0)` })
      .from(ledgerEntry)
      .where(
        and(
          eq(ledgerEntry.userId, userId),
          eq(ledgerEntry.type, "credit"),
          gte(ledgerEntry.createdAt, weekAgo)
        )
      );

    return reply.send({
      success: true,
      data: {
        balance: Number(w.balance),
        totalEarned: Number(w.totalEarned),
        thisWeek: Number(weekRow?.total ?? 0),
        currency: w.currency,
      },
    });
  });

  // GET /api/wallet/transactions — recent ledger entries
  fastify.get("/api/wallet/transactions", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).session.user.id as string;
    const { limit } = request.query as { limit?: string };
    const take = Math.min(Number(limit) || 50, 200);

    const entries = await db
      .select()
      .from(ledgerEntry)
      .where(eq(ledgerEntry.userId, userId))
      .orderBy(desc(ledgerEntry.createdAt))
      .limit(take);

    return reply.send({ success: true, data: entries });
  });

  // GET /api/wallet/banks — bank list for the transfer-method picker
  fastify.get("/api/wallet/banks", { preHandler: [requireAuth] }, async (_request, reply) => {
    if (!isPaystackConfigured()) {
      return reply.send({ success: true, data: FALLBACK_BANKS });
    }
    try {
      const banks = await listBanks();
      return reply.send({ success: true, data: banks.length ? banks : FALLBACK_BANKS });
    } catch {
      return reply.send({ success: true, data: FALLBACK_BANKS });
    }
  });

  // GET /api/wallet/transfer-methods
  fastify.get("/api/wallet/transfer-methods", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).session.user.id as string;
    const methods = await db
      .select()
      .from(transferRecipient)
      .where(eq(transferRecipient.userId, userId))
      .orderBy(desc(transferRecipient.isDefault), desc(transferRecipient.createdAt));
    return reply.send({ success: true, data: methods });
  });

  // POST /api/wallet/transfer-methods — add a bank destination
  fastify.post("/api/wallet/transfer-methods", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).session.user.id as string;
    const body = (request.body ?? {}) as {
      bankName?: string;
      bankCode?: string;
      accountNumber?: string;
      accountName?: string;
    };

    if (!body.bankName || !body.bankCode || !body.accountNumber) {
      return reply.status(400).send({ success: false, error: "bankName, bankCode and accountNumber are required" });
    }

    let accountName = body.accountName?.trim();
    let recipientCode: string | null = null;

    if (isPaystackConfigured()) {
      try {
        if (!accountName) accountName = await resolveAccountName(body.accountNumber, body.bankCode);
        recipientCode = await createTransferRecipient({
          name: accountName || body.accountNumber,
          accountNumber: body.accountNumber,
          bankCode: body.bankCode,
        });
      } catch (err: any) {
        // If verification fails and no name was supplied, reject — otherwise save unverified.
        if (!accountName) {
          return reply.status(400).send({ success: false, error: err?.message || "Could not verify bank account" });
        }
      }
    }

    if (!accountName) {
      return reply.status(400).send({ success: false, error: "accountName is required" });
    }

    // First method added becomes the default.
    const existing = await db
      .select({ id: transferRecipient.id })
      .from(transferRecipient)
      .where(eq(transferRecipient.userId, userId));
    const isDefault = existing.length === 0;

    const [created] = await db
      .insert(transferRecipient)
      .values({
        userId,
        bankName: body.bankName,
        bankCode: body.bankCode,
        accountNumber: body.accountNumber,
        accountName,
        paystackRecipientCode: recipientCode,
        isDefault,
      })
      .returning();

    return reply.status(201).send({ success: true, data: created });
  });

  // POST /api/wallet/transfer-methods/:id/default
  fastify.post(
    "/api/wallet/transfer-methods/:id/default",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = (request as any).session.user.id as string;
      const { id } = request.params as { id: string };

      const method = await db.query.transferRecipient.findFirst({
        where: and(eq(transferRecipient.id, id), eq(transferRecipient.userId, userId)),
      });
      if (!method) return reply.status(404).send({ success: false, error: "Transfer method not found" });

      await db
        .update(transferRecipient)
        .set({ isDefault: false })
        .where(eq(transferRecipient.userId, userId));
      await db.update(transferRecipient).set({ isDefault: true }).where(eq(transferRecipient.id, id));

      return reply.send({ success: true });
    }
  );

  // DELETE /api/wallet/transfer-methods/:id
  fastify.delete(
    "/api/wallet/transfer-methods/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = (request as any).session.user.id as string;
      const { id } = request.params as { id: string };

      const method = await db.query.transferRecipient.findFirst({
        where: and(eq(transferRecipient.id, id), eq(transferRecipient.userId, userId)),
      });
      if (!method) return reply.status(404).send({ success: false, error: "Transfer method not found" });

      await db.delete(transferRecipient).where(eq(transferRecipient.id, id));
      return reply.send({ success: true });
    }
  );

  // GET /api/wallet/payouts — withdrawal history
  fastify.get("/api/wallet/payouts", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).session.user.id as string;
    const payouts = await db
      .select()
      .from(payout)
      .where(eq(payout.userId, userId))
      .orderBy(desc(payout.createdAt));
    return reply.send({ success: true, data: payouts });
  });

  // POST /api/wallet/payouts — request a withdrawal
  fastify.post("/api/wallet/payouts", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).session.user.id as string;
    const body = (request.body ?? {}) as { amount?: number; transferRecipientId?: string };

    const amount = Number(body.amount);
    if (!amount || amount <= 0) {
      return reply.status(400).send({ success: false, error: "A valid amount is required" });
    }

    const method = body.transferRecipientId
      ? await db.query.transferRecipient.findFirst({
          where: and(
            eq(transferRecipient.id, body.transferRecipientId),
            eq(transferRecipient.userId, userId)
          ),
        })
      : await db.query.transferRecipient.findFirst({
          where: and(eq(transferRecipient.userId, userId), eq(transferRecipient.isDefault, true)),
        });

    if (!method) {
      return reply.status(400).send({ success: false, error: "Add a bank account before withdrawing" });
    }

    const w = await getOrCreateWallet(userId);
    if (Number(w.balance) < amount) {
      return reply.status(400).send({ success: false, error: "Insufficient wallet balance" });
    }

    const reference = `PO_${crypto.randomBytes(12).toString("hex")}`;

    const [created] = await db
      .insert(payout)
      .values({
        userId,
        walletId: w.id,
        transferRecipientId: method.id,
        amount: amount.toFixed(2),
        status: "pending",
        reference,
        destinationBankName: method.bankName,
        destinationAccountNumber: method.accountNumber,
        destinationAccountName: method.accountName,
      })
      .returning();

    try {
      await debitWallet(userId, {
        amount,
        category: "payout",
        payoutId: created.id,
        description: `Withdrawal to ${method.bankName} ••${method.accountNumber.slice(-4)}`,
      });
    } catch (err: any) {
      // Roll back the payout request if the debit failed (e.g. race condition).
      await db.delete(payout).where(eq(payout.id, created.id));
      const msg = err?.message === "INSUFFICIENT_FUNDS" ? "Insufficient wallet balance" : "Could not process withdrawal";
      return reply.status(400).send({ success: false, error: msg });
    }

    return reply.status(201).send({ success: true, data: created });
  });

  // ── Admin payout operations ─────────────────────────────────
  // Accessible to admins (incl. the x-internal-secret synthetic admin used by
  // the dashboard).

  // GET /api/admin/payouts — all payouts with requester details
  fastify.get(
    "/api/admin/payouts",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { status } = request.query as { status?: string };
      const base = db
        .select({
          id: payout.id,
          userId: payout.userId,
          userName: user.name,
          userEmail: user.email,
          userRole: user.role,
          amount: payout.amount,
          status: payout.status,
          reference: payout.reference,
          destinationBankName: payout.destinationBankName,
          destinationAccountNumber: payout.destinationAccountNumber,
          destinationAccountName: payout.destinationAccountName,
          failureReason: payout.failureReason,
          processedAt: payout.processedAt,
          createdAt: payout.createdAt,
        })
        .from(payout)
        .leftJoin(user, eq(payout.userId, user.id));

      const rows = status
        ? await base.where(eq(payout.status, status as any)).orderBy(desc(payout.createdAt))
        : await base.orderBy(desc(payout.createdAt));

      const pendingTotal = rows
        .filter((r) => r.status === "pending" || r.status === "processing")
        .reduce((sum, r) => sum + Number(r.amount), 0);

      return reply.send({ success: true, data: { payouts: rows, pendingTotal } });
    }
  );

  // POST /api/admin/payouts/:id/approve — settle a payout
  fastify.post(
    "/api/admin/payouts/:id/approve",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = await db.query.payout.findFirst({ where: eq(payout.id, id) });
      if (!row) return reply.status(404).send({ success: false, error: "Payout not found" });
      if (row.status !== "pending" && row.status !== "processing") {
        return reply.status(409).send({ success: false, error: `Payout is already ${row.status}` });
      }

      let finalStatus: "paid" | "processing" = "paid";
      let transferCode: string | null = null;

      const recipient = row.transferRecipientId
        ? await db.query.transferRecipient.findFirst({ where: eq(transferRecipient.id, row.transferRecipientId) })
        : null;

      if (isPaystackConfigured() && recipient?.paystackRecipientCode) {
        try {
          const result = await initiateTransfer({
            amountNaira: Number(row.amount),
            recipientCode: recipient.paystackRecipientCode,
            reference: row.reference,
            reason: "Plokitch payout",
          });
          transferCode = result.transferCode;
          finalStatus = result.status === "success" ? "paid" : "processing";
        } catch (err: any) {
          return reply.status(502).send({ success: false, error: err?.message || "Transfer failed" });
        }
      }

      const [updated] = await db
        .update(payout)
        .set({
          status: finalStatus,
          paystackTransferCode: transferCode,
          processedAt: finalStatus === "paid" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(payout.id, id))
        .returning();

      await notifyUser({
        userId: row.userId,
        type: "payout",
        title: finalStatus === "paid" ? "Payout sent" : "Payout processing",
        body:
          finalStatus === "paid"
            ? `₦${Number(row.amount).toLocaleString()} has been sent to your bank account.`
            : `Your ₦${Number(row.amount).toLocaleString()} payout is being processed.`,
        data: { payoutId: row.id, status: finalStatus },
      });

      return reply.send({ success: true, data: updated });
    }
  );

  // POST /api/admin/payouts/:id/reject — decline and refund the wallet
  fastify.post(
    "/api/admin/payouts/:id/reject",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reason } = (request.body ?? {}) as { reason?: string };

      const row = await db.query.payout.findFirst({ where: eq(payout.id, id) });
      if (!row) return reply.status(404).send({ success: false, error: "Payout not found" });
      if (row.status !== "pending" && row.status !== "processing") {
        return reply.status(409).send({ success: false, error: `Payout is already ${row.status}` });
      }

      // Refund the held amount back to the wallet.
      await creditWallet(row.userId, {
        amount: Number(row.amount),
        category: "payout_reversal",
        payoutId: row.id,
        description: "Payout declined — funds returned",
      });

      const [updated] = await db
        .update(payout)
        .set({
          status: "failed",
          failureReason: reason || "Declined by admin",
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(payout.id, id))
        .returning();

      await notifyUser({
        userId: row.userId,
        type: "payout",
        title: "Payout declined",
        body: `Your ₦${Number(row.amount).toLocaleString()} payout was declined and refunded to your wallet.`,
        data: { payoutId: row.id, status: "failed" },
      });

      return reply.send({ success: true, data: updated });
    }
  );
}

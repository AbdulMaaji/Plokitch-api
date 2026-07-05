import { db } from "../db/index.js";
import { wallet, ledgerEntry } from "../db/schema.js";
import { eq } from "drizzle-orm";

// Either the base db or a transaction handle — both expose query/insert/update.
type Executor = any;

function toMoney(n: number): string {
  return n.toFixed(2);
}

/** Fetch the user's wallet, creating an empty one on first access. */
export async function getOrCreateWallet(userId: string, exec: Executor = db) {
  const existing = await exec.query.wallet.findFirst({ where: eq(wallet.userId, userId) });
  if (existing) return existing;

  const [created] = await exec
    .insert(wallet)
    .values({ userId })
    .onConflictDoNothing({ target: wallet.userId })
    .returning();

  // onConflictDoNothing can return nothing if a concurrent insert won the race.
  if (created) return created;
  return (await exec.query.wallet.findFirst({ where: eq(wallet.userId, userId) }))!;
}

interface CreditParams {
  amount: number;
  category: "delivery_earning" | "order_revenue" | "payout_reversal" | "adjustment";
  orderId?: string | null;
  payoutId?: string | null;
  description?: string;
}

/**
 * Credit a user's wallet and write a matching ledger entry. Runs in a
 * transaction so balance + ledger stay consistent. No-op for amount <= 0.
 */
export async function creditWallet(userId: string, params: CreditParams) {
  if (!params.amount || params.amount <= 0) return null;

  return db.transaction(async (tx) => {
    const w = await getOrCreateWallet(userId, tx);
    const newBalance = Number(w.balance) + params.amount;
    const newTotal = Number(w.totalEarned) + params.amount;

    const [updated] = await tx
      .update(wallet)
      .set({ balance: toMoney(newBalance), totalEarned: toMoney(newTotal), updatedAt: new Date() })
      .where(eq(wallet.id, w.id))
      .returning();

    await tx.insert(ledgerEntry).values({
      walletId: w.id,
      userId,
      type: "credit",
      category: params.category,
      amount: toMoney(params.amount),
      balanceAfter: toMoney(newBalance),
      orderId: params.orderId ?? null,
      payoutId: params.payoutId ?? null,
      description: params.description,
    });

    return updated;
  });
}

interface DebitParams {
  amount: number;
  category: "payout" | "adjustment";
  payoutId?: string | null;
  description?: string;
}

/**
 * Debit a user's wallet (e.g. a payout). Throws "INSUFFICIENT_FUNDS" if the
 * balance can't cover the amount. Transactional with the ledger entry.
 */
export async function debitWallet(userId: string, params: DebitParams) {
  if (!params.amount || params.amount <= 0) {
    throw new Error("INVALID_AMOUNT");
  }

  return db.transaction(async (tx) => {
    const w = await getOrCreateWallet(userId, tx);
    const current = Number(w.balance);
    if (current < params.amount) {
      throw new Error("INSUFFICIENT_FUNDS");
    }
    const newBalance = current - params.amount;

    const [updated] = await tx
      .update(wallet)
      .set({ balance: toMoney(newBalance), updatedAt: new Date() })
      .where(eq(wallet.id, w.id))
      .returning();

    await tx.insert(ledgerEntry).values({
      walletId: w.id,
      userId,
      type: "debit",
      category: params.category,
      amount: toMoney(params.amount),
      balanceAfter: toMoney(newBalance),
      payoutId: params.payoutId ?? null,
      description: params.description,
    });

    return updated;
  });
}

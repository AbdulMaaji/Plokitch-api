/**
 * Thin Paystack HTTP client. All calls are guarded: when PAYSTACK_SECRET_KEY is
 * not configured (local dev / tests) the helpers throw a typed error so callers
 * can degrade gracefully instead of hard-failing.
 */

export const PAYSTACK_BASE = "https://api.paystack.co";

export class PaystackNotConfiguredError extends Error {
  constructor() {
    super("Paystack is not configured");
    this.name = "PaystackNotConfiguredError";
  }
}

export function isPaystackConfigured(): boolean {
  return !!process.env.PAYSTACK_SECRET_KEY;
}

async function paystackFetch<T = any>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new PaystackNotConfiguredError();

  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload: any = await res.json().catch(() => ({}));
  if (!res.ok || payload?.status === false) {
    const message = payload?.message || `Paystack request failed (${res.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export interface PaystackBank {
  name: string;
  code: string;
  currency: string;
}

/** List Nigerian banks (for the transfer-method picker). */
export async function listBanks(): Promise<PaystackBank[]> {
  const res = await paystackFetch<{ data: PaystackBank[] }>("/bank?currency=NGN");
  return res.data ?? [];
}

/** Resolve an account number against a bank code to confirm the account name. */
export async function resolveAccountName(
  accountNumber: string,
  bankCode: string
): Promise<string> {
  const res = await paystackFetch<{ data: { account_name: string } }>(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
  );
  return res.data.account_name;
}

/** Create a Paystack transfer recipient; returns the RCP_ recipient code. */
export async function createTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<string> {
  const res = await paystackFetch<{ data: { recipient_code: string } }>("/transferrecipient", {
    method: "POST",
    body: JSON.stringify({
      type: "nuban",
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: "NGN",
    }),
  });
  return res.data.recipient_code;
}

/** Initiate a transfer to a recipient. Amount is in naira (converted to kobo). */
export async function initiateTransfer(params: {
  amountNaira: number;
  recipientCode: string;
  reference: string;
  reason?: string;
}): Promise<{ transferCode: string; status: string }> {
  const res = await paystackFetch<{ data: { transfer_code: string; status: string } }>("/transfer", {
    method: "POST",
    body: JSON.stringify({
      source: "balance",
      amount: Math.round(params.amountNaira * 100),
      recipient: params.recipientCode,
      reference: params.reference,
      reason: params.reason ?? "Plokitch payout",
    }),
  });
  return { transferCode: res.data.transfer_code, status: res.data.status };
}

/** Static fallback bank list used when Paystack is not configured. */
export const FALLBACK_BANKS: PaystackBank[] = [
  { name: "Access Bank", code: "044", currency: "NGN" },
  { name: "Guaranty Trust Bank", code: "058", currency: "NGN" },
  { name: "Zenith Bank", code: "057", currency: "NGN" },
  { name: "United Bank for Africa", code: "033", currency: "NGN" },
  { name: "First Bank of Nigeria", code: "011", currency: "NGN" },
  { name: "Fidelity Bank", code: "070", currency: "NGN" },
  { name: "Union Bank of Nigeria", code: "032", currency: "NGN" },
  { name: "Sterling Bank", code: "232", currency: "NGN" },
  { name: "Stanbic IBTC Bank", code: "221", currency: "NGN" },
  { name: "Ecobank Nigeria", code: "050", currency: "NGN" },
  { name: "Kuda Bank", code: "50211", currency: "NGN" },
  { name: "Opay", code: "999992", currency: "NGN" },
  { name: "PalmPay", code: "999991", currency: "NGN" },
  { name: "Moniepoint MFB", code: "50515", currency: "NGN" },
];

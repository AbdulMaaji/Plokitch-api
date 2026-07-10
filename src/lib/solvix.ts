/**
 * Thin Solvix Go Logistics HTTP client. Wraps the three core endpoints:
 *   - POST /developer/order          → createDelivery
 *   - GET  /developer/order/:id      → getDeliveryStatus
 *   - POST /developer/order/:id/cancel → cancelDelivery
 *
 * Base URL: https://solvixgo-logistics-backend.onrender.com/api/v1
 *
 * When SOLVIX_PUBLIC_KEY / SOLVIX_SECRET_KEY are not configured (local dev /
 * tests) the helpers throw a typed error so callers can degrade gracefully.
 */

import crypto from "node:crypto";

const SOLVIX_BASE = "https://solvixgo-logistics-backend.onrender.com/api/v1";

// ──────────────────────────────────────────────────────────────
// Types — matching actual Solvix Go API docs
// ──────────────────────────────────────────────────────────────

/** Solvix returns capitalized status strings. */
export type SolvixDeliveryStatus =
  | "Pending"
  | "Assigned"
  | "Picked Up"
  | "In Transit"
  | "Delivered"
  | "Cancelled";

/** Payload for POST /developer/order */
export interface SolvixCreateDeliveryPayload {
  pickupName: string;
  pickupAddress: string;
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  packageDescription: string;
  paymentType: "Cash" | "Online";
}

/** Response from POST /developer/order (201) */
export interface SolvixCreateDeliveryResponse {
  success: boolean;
  data: {
    deliveryId: string;
    status: SolvixDeliveryStatus;
    pickupName: string;
    pickupAddress: string;
    receiverName: string;
    receiverPhone: string;
    deliveryAddress: string;
    packageDescription: string;
    createdAt: string;
  };
}

/** Response from GET /developer/order/:id (200) */
export interface SolvixDeliveryStatusResponse {
  success: boolean;
  data: {
    deliveryId: string;
    status: SolvixDeliveryStatus;
    riderName?: string;
    pickupAddress: string;
    deliveryAddress: string;
    createdAt: string;
  };
}

/** Response from POST /developer/order/:id/cancel (200) */
export interface SolvixCancelDeliveryResponse {
  success: boolean;
  message: string;
  data: {
    deliveryId: string;
    status: SolvixDeliveryStatus;
  };
}

/** Webhook payload pushed by Solvix on status changes. */
export interface SolvixWebhookPayload {
  deliveryId: string;
  status: SolvixDeliveryStatus;
  riderName?: string;
  timestamp: string;
}

// ──────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────

export class SolvixNotConfiguredError extends Error {
  constructor() {
    super("Solvix is not configured — set SOLVIX_PUBLIC_KEY and SOLVIX_SECRET_KEY");
    this.name = "SolvixNotConfiguredError";
  }
}

export class SolvixApiError extends Error {
  statusCode: number;
  solvixMessage: string;

  constructor(statusCode: number, message: string) {
    super(`Solvix API error (${statusCode}): ${message}`);
    this.name = "SolvixApiError";
    this.statusCode = statusCode;
    this.solvixMessage = message;
  }
}

// ──────────────────────────────────────────────────────────────
// Configuration helpers
// ──────────────────────────────────────────────────────────────

function getConfig() {
  const publicKey = process.env.SOLVIX_PUBLIC_KEY;
  const secretKey = process.env.SOLVIX_SECRET_KEY;
  if (!publicKey || !secretKey) throw new SolvixNotConfiguredError();
  return { publicKey, secretKey };
}

export function isSolvixConfigured(): boolean {
  return !!(process.env.SOLVIX_PUBLIC_KEY && process.env.SOLVIX_SECRET_KEY);
}

// ──────────────────────────────────────────────────────────────
// Internal fetch wrapper
// ──────────────────────────────────────────────────────────────

async function solvixFetch<T = any>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const { publicKey, secretKey } = getConfig();

  const res = await fetch(`${SOLVIX_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Solvix-Public-Key": publicKey,
      "X-Solvix-Secret-Key": secretKey,
      ...(init?.headers ?? {}),
    },
  });

  const payload: any = await res.json().catch(() => ({}));

  if (!res.ok || payload?.success === false) {
    const message =
      payload?.message || `Solvix request failed (${res.status})`;
    throw new SolvixApiError(res.status, message);
  }

  return payload as T;
}

// ──────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────

/**
 * Create a new delivery with Solvix Go.
 * Returns the delivery ID for tracking and webhook correlation.
 */
export async function createDelivery(
  payload: SolvixCreateDeliveryPayload
): Promise<SolvixCreateDeliveryResponse["data"]> {
  const res = await solvixFetch<SolvixCreateDeliveryResponse>(
    "/developer/order",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return res.data;
}

/**
 * Query the current status of a delivery by its Solvix delivery ID.
 */
export async function getDeliveryStatus(
  deliveryId: string
): Promise<SolvixDeliveryStatusResponse["data"]> {
  const res = await solvixFetch<SolvixDeliveryStatusResponse>(
    `/developer/order/${encodeURIComponent(deliveryId)}`
  );
  return res.data;
}

/**
 * Request cancellation of an in-progress delivery.
 */
export async function cancelDelivery(
  deliveryId: string
): Promise<SolvixCancelDeliveryResponse["data"]> {
  const res = await solvixFetch<SolvixCancelDeliveryResponse>(
    `/developer/order/${encodeURIComponent(deliveryId)}/cancel`,
    { method: "POST" }
  );
  return res.data;
}

/**
 * Verify a Solvix webhook signature using HMAC-SHA256 with timing-safe
 * comparison. Returns true if the signature is valid.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string
): boolean {
  const secret = process.env.SOLVIX_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // Timing-safe comparison on the hex strings directly.
  const sigBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");

  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

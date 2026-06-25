/**
 * Delivery pricing — the single server-side source of truth for Gombe
 * zone delivery fees (in NGN).
 *
 * The client may *display* these fees, but the server must always recompute
 * the fee from the zone string on order creation. Never trust a client-sent
 * delivery fee.
 */
export const DELIVERY_ZONE_FEES: Record<string, number> = {
  "Central Areas": 700,
  "Inner Suburbs": 800,
  "Outer Areas": 1000,
  "Extended Zones": 1200,
  "North-Eastern University": 2000,
};

/** Fallback fee used when an unknown / missing zone is supplied. */
export const DEFAULT_DELIVERY_FEE = 1000;

/**
 * Resolve the delivery fee (NGN) for a given zone name. Unknown or missing
 * zones fall back to DEFAULT_DELIVERY_FEE so an order is never under-charged
 * to zero by a bad client payload.
 */
export function resolveDeliveryFee(zone?: string | null): number {
  if (!zone) return DEFAULT_DELIVERY_FEE;
  const fee = DELIVERY_ZONE_FEES[zone.trim()];
  return typeof fee === "number" ? fee : DEFAULT_DELIVERY_FEE;
}

/** Whether the given zone string is a recognised delivery zone. */
export function isValidDeliveryZone(zone?: string | null): boolean {
  return !!zone && Object.prototype.hasOwnProperty.call(DELIVERY_ZONE_FEES, zone.trim());
}

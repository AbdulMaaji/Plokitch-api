# Solvix Go Delivery Integration — Webhook Endpoint

## Endpoint

```
POST https://api.plokitch.app/webhooks/solvix
```

### What it expects

Solvix pushes delivery status updates to this endpoint as JSON:

```json
{
  "deliveryId": "svx_abc123",
  "orderId": "uuid-of-order",
  "status": "assigned" | "picked_up" | "in_transit" | "delivered" | "cancelled",
  "riderName": "John Doe",
  "riderPhone": "+234...",
  "timestamp": "2025-07-10T14:30:00Z"
}
```

### Authentication

Every request must include an HMAC-SHA256 signature in the `X-Solvix-Signature` header. The signature is computed over the raw request body using `SOLVIX_WEBHOOK_SECRET`. Requests without a valid signature are rejected with `401`.

### How to configure in the Solvix console

1. Log in to the Solvix Go developer dashboard
2. Navigate to **Webhooks** / **Settings**
3. Set the webhook URL to: `https://api.plokitch.app/webhooks/solvix`
4. Copy the **Webhook Secret** — this becomes `SOLVIX_WEBHOOK_SECRET` in your env
5. Enable the following events: `assigned`, `picked_up`, `in_transit`, `delivered`, `cancelled`

---

## Curl example — testing locally

Generate a test signature and fire the webhook against your local dev server:

```bash
# Set your webhook secret (must match SOLVIX_WEBHOOK_SECRET env var)
WEBHOOK_SECRET="your-webhook-secret-here"

# Build the payload
PAYLOAD='{"deliveryId":"svx_test_123","orderId":"test-order-uuid","status":"assigned","riderName":"Test Rider","timestamp":"2025-07-10T14:30:00Z"}'

# Compute HMAC-SHA256 signature
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

# Fire the request
curl -X POST http://localhost:4000/webhooks/solvix \
  -H "Content-Type: application/json" \
  -H "X-Solvix-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

Expected response: `{"received":true}`

### Curl example — against staging

```bash
WEBHOOK_SECRET="your-webhook-secret-here"
PAYLOAD='{"deliveryId":"svx_staging_456","orderId":"your-staging-order-uuid","status":"in_transit","riderName":"Staging Rider","timestamp":"2025-07-10T15:00:00Z"}'

SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST https://api.plokitch.app/webhooks/solvix \
  -H "Content-Type: application/json" \
  -H "X-Solvix-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

---

## Env vars to set in DigitalOcean

| Variable | Where to find it | Required |
|---|---|---|
| `SOLVIX_PUBLIC_KEY` | Solvix dashboard → API Keys → Public Key | Yes |
| `SOLVIX_SECRET_KEY` | Solvix dashboard → API Keys → Secret Key | Yes |
| `SOLVIX_WEBHOOK_SECRET` | Solvix dashboard → Webhooks → Secret | Yes (for webhook verification) |

All three must be set in your DigitalOcean App Platform environment variables before this goes live.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/solvix.ts` | **New** — Solvix API client (createDelivery, getDeliveryStatus, cancelDelivery, verifyWebhookSignature) |
| `src/routes/solvix.routes.ts` | **New** — `POST /webhooks/solvix` endpoint with raw body HMAC verification |
| `src/db/schema.ts` | Added `solvixStatusEnum`, `solvixDeliveryId`, `solvixStatus`, `solvixRiderName` to order table |
| `src/routes/orders.routes.ts` | Added Solvix dispatch trigger when order becomes `ready` + notification wiring |
| `src/index.ts` | Registered `solvixWebhookRoutes` |
| `drizzle/0011_add_solvix_delivery_fields.sql` | **New** — Migration SQL for enum + columns + index |
| `drizzle/meta/_journal.json` | Updated migration journal |
| `.env.example` | Added `SOLVIX_PUBLIC_KEY`, `SOLVIX_SECRET_KEY`, `SOLVIX_WEBHOOK_SECRET` |
| `.env` | Added Solvix credentials |

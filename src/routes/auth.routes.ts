import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { db } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import {
  invite,
  vendor,
  riderProfile,
  deliveryCompany,
  joinApplication,
  user,
  session as sessionSchema,
} from "../db/schema.js";
import { randomUUID } from "crypto";

const COOKIE_DOMAIN =
  process.env.NODE_ENV === "production" ? ".plokitch.app" : undefined;

/**
 * Rewrites a Set-Cookie header value to inject Domain=.plokitch.app in
 * production, so the session cookie is shared across all *.plokitch.app
 * subdomains (e.g. dashboard.plokitch.app can read api.plokitch.app cookies).
 */
function patchCookieDomain(cookieValue: string): string {
  if (!COOKIE_DOMAIN) return cookieValue;
  // Only add Domain if it isn't already set
  if (/;\s*Domain=/i.test(cookieValue)) return cookieValue;
  return `${cookieValue}; Domain=${COOKIE_DOMAIN}`;
}

/**
 * Auth routes — Better Auth handler catch-all.
 * All /api/auth/* requests are forwarded to Better Auth.
 */
export async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/accept-invite — Accept operator invitation and setup credentials
  fastify.post("/api/auth/accept-invite", async (request, reply) => {
    const { token, name, password } = request.body as {
      token?: string;
      name?: string;
      password?: string;
    };

    if (!token || !name || !password) {
      return reply.status(400).send({
        success: false,
        error: "Token, name, and password are required fields",
      });
    }

    if (password.length < 8) {
      return reply.status(400).send({
        success: false,
        error: "Password must be at least 8 characters long",
      });
    }

    try {
      // 1. Retrieve and validate the invitation token
      const inviteRecord = await db.query.invite.findFirst({
        where: eq(invite.token, token),
      });

      if (!inviteRecord) {
        return reply.status(404).send({
          success: false,
          error: "Invitation not found. Please ask the administrator for a new link.",
        });
      }

      if (inviteRecord.status === "revoked") {
        return reply.status(400).send({
          success: false,
          error: "This invitation link has been revoked by administration.",
        });
      }

      if (inviteRecord.status === "used" || inviteRecord.usedAt) {
        return reply.status(400).send({
          success: false,
          error: "This invitation link has already been used.",
        });
      }

      if (inviteRecord.status === "expired" || inviteRecord.expiresAt < new Date()) {
        return reply.status(400).send({
          success: false,
          error: "This invitation link has expired. Please ask the administrator for a new one.",
        });
      }

      // 2. Delegate secure user registration directly to Better Auth's standard sign-up flow
      const signupReq = new Request(
        `${request.protocol}://${request.headers.host}/api/auth/sign-up/email`,
        {
          method: "POST",
          headers: new Headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            email: inviteRecord.email,
            password,
            name,
            role: inviteRecord.role, // "chef" or "rider"
          }),
        }
      );

      const response = await auth.handler(signupReq);

      if (response.status >= 400) {
        const bodyText = await response.text();
        const errJson = JSON.parse(bodyText || "{}");
        return reply.status(response.status).send({
          success: false,
          error: errJson.error || errJson.message || "Failed to create user credentials",
        });
      }

      // Parse successfully registered user
      const bodyText = await response.text();
      const userPayload = JSON.parse(bodyText || "{}");
      const userId = userPayload.user.id;

      // Map the invite role to the platform user role. Company-fleet invites
      // become "company_rider" owner accounts.
      const userRole =
        inviteRecord.role === "company" ? "company_rider" : (inviteRecord.role as "chef" | "rider");

      // Update the user record securely in the database to override standard "customer" default
      await db
        .update(user)
        .set({ role: userRole })
        .where(eq(user.id, userId));

      // 3. Atomically initialize the operator's operational profile
      if (inviteRecord.role === "chef") {
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

        await db.insert(vendor).values({
          userId,
          businessName: `${name}'s Kitchen`,
          slug,
          isActive: false,
          isVerified: false,
        });
      } else if (inviteRecord.role === "rider") {
        // A companyId on the invite means this rider belongs to a fleet.
        const isCompanyRider = !!inviteRecord.companyId;
        await db.insert(riderProfile).values({
          userId,
          isAvailable: false,
          isVerified: false,
          // Riders onboarded through the admin invite flow are pre-approved,
          // so the new application-gating model doesn't lock them out.
          riderType: isCompanyRider ? "company" : "single",
          companyId: inviteRecord.companyId ?? null,
          applicationStatus: "approved",
          approvedAt: new Date(),
        });
      } else if (inviteRecord.role === "company") {
        // The fleet application was approved by an admin before this invite was
        // sent — pull the captured company details from joinApplication.
        const companyApp = await db.query.joinApplication.findFirst({
          where: and(
            eq(joinApplication.contactEmail, inviteRecord.email),
            eq(joinApplication.applicantType, "delivery_company"),
            eq(joinApplication.applicationStatus, "approved")
          ),
        });

        await db.insert(deliveryCompany).values({
          userId,
          companyName: companyApp?.businessName ?? name,
          contactName: companyApp?.contactName ?? name,
          contactEmail: inviteRecord.email,
          contactPhone: companyApp?.contactPhone ?? "",
          rcNumber: companyApp?.rcNumber ?? null,
          fleetSize: companyApp?.declaredFleetSize ?? 0,
          applicationStatus: "approved",
          approvedAt: companyApp?.reviewedAt ?? new Date(),
          approvedBy: companyApp?.reviewedBy ?? null,
        });
      }

      // 4. Mark invite as used
      await db
        .update(invite)
        .set({ status: "used", usedAt: new Date() })
        .where(eq(invite.id, inviteRecord.id));

      // 5. Programmatically create and persist a new Better Auth session directly in the database
      const sessionId = randomUUID();
      const sessionToken = randomUUID().replace(/-/g, "");
      const sessionExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

      await db.insert(sessionSchema).values({
        id: sessionId,
        token: sessionToken,
        userId,
        expiresAt: sessionExpires,
        createdAt: new Date(),
        updatedAt: new Date(),
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      });

      // 6. Set the authentication cookie on the reply
      const isProd = process.env.NODE_ENV === "production";
      const domainAttr = isProd ? "; Domain=.plokitch.app" : "";
      const secureAttr = isProd ? "; Secure" : "";
      
      const cookieValue = `plotkitch.session_token=${sessionToken}; Path=/; Expires=${sessionExpires.toUTCString()}; HttpOnly; SameSite=Lax${domainAttr}${secureAttr}`;
      reply.header("Set-Cookie", cookieValue);

      reply.status(200);
      return reply.send({
        success: true,
        role: inviteRecord.role,
        redirectTo: "/download?onboarded=1",
      });
    } catch (err: any) {
      fastify.log.error(err, "CRITICAL Accept invite processing error");
      return reply.status(500).send({
        success: false,
        error: err.message || "An unexpected error occurred while processing invitation",
      });
    }
  });

  // GET /api/auth/verify-invite — verify token on mount
  fastify.get("/api/auth/verify-invite", async (request, reply) => {
    const { token } = request.query as { token?: string };
    if (!token) {
      return reply.status(400).send({ success: false, error: "Token is required" });
    }
    const inviteRecord = await db.query.invite.findFirst({
      where: eq(invite.token, token),
    });
    if (!inviteRecord) {
      return reply.status(404).send({ success: false, error: "Invitation not found" });
    }
    if (inviteRecord.status === "revoked") {
      return reply.status(400).send({ success: false, error: "This invitation link has been revoked by administration.", code: "REVOKED" });
    }
    if (inviteRecord.status === "used" || inviteRecord.usedAt) {
      return reply.status(400).send({ success: false, error: "This invitation link has already been used.", code: "USED" });
    }
    if (inviteRecord.status === "expired" || inviteRecord.expiresAt < new Date()) {
      return reply.status(400).send({ success: false, error: "This invitation link has expired. Please ask the administrator for a new one.", code: "EXPIRED" });
    }
    return reply.send({ success: true, email: inviteRecord.email, role: inviteRecord.role });
  });

  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      try {
        const url = new URL(
          request.url,
          `${request.protocol}://${request.headers.host}`
        );

        const headers = fromNodeHeaders(request.headers);
        // Important: Remove content-length as the new Request will calculate its own from the stringified body
        headers.delete("content-length");

        const req = new Request(url.toString(), {
          method: request.method,
          headers,
          ...(request.body
            ? { body: JSON.stringify(request.body) }
            : {}),
        });

        const response = await auth.handler(req);

        reply.status(response.status);

        response.headers.forEach((value: string, key: string) => {
          if (key.toLowerCase() === "set-cookie") {
            // Patch domain so cookies are visible across *.plokitch.app
            reply.header(key, patchCookieDomain(value));
          } else {
            reply.header(key, value);
          }
        });

        const body = await response.text();

        if (response.status >= 400) {
          fastify.log.warn({ status: response.status, body }, "Auth handler error response");
        }

        return reply.send(body || null);
      } catch (error) {
        fastify.log.error(error, "CRITICAL Auth handler error");
        return reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : "Internal authentication error",
          code: "AUTH_FAILURE",
        });
      }
    },
  });
}

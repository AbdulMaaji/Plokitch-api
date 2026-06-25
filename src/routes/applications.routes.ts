import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { joinApplication } from "../db/schema.js";
import { sendNewApplicationAlert } from "../lib/email.js";

const RECEIVED_MESSAGE =
  "Application received. We'll be in touch within 2–3 business days.";

// Vendor / Home Chef application
const vendorSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required"),
  contactName: z.string().trim().min(1, "Contact name is required"),
  contactEmail: z.string().trim().email("A valid email is required"),
  contactPhone: z.string().trim().min(1, "Contact phone is required"),
  location: z.string().trim().optional().nullable(),
  cuisineTypes: z.array(z.string()).optional().nullable(),
  kitchenBio: z.string().trim().optional().nullable(),
  isHomeChef: z.boolean().optional(),
});

// Single rider application
const riderSchema = z.object({
  contactName: z.string().trim().min(1, "Contact name is required"),
  contactEmail: z.string().trim().email("A valid email is required"),
  contactPhone: z.string().trim().min(1, "Contact phone is required"),
  vehicleType: z.string().trim().optional().nullable(),
  vehiclePlate: z.string().trim().optional().nullable(),
  location: z.string().trim().optional().nullable(),
});

// Delivery company / fleet application
const fleetSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required"),
  contactName: z.string().trim().min(1, "Contact name is required"),
  contactEmail: z.string().trim().email("A valid email is required"),
  contactPhone: z.string().trim().min(1, "Contact phone is required"),
  rcNumber: z.string().trim().optional().nullable(),
  declaredFleetSize: z.number().int().nonnegative().optional().nullable(),
  operatingZones: z.array(z.string()).optional().nullable(),
});

function validationError(reply: any, error: z.ZodError) {
  return reply.status(400).send({
    success: false,
    error: error.issues[0]?.message || "Invalid application payload",
    code: "VALIDATION_ERROR",
  });
}

/**
 * Public application routes — /api/apply/*
 * No authentication required (public Join Us form submissions).
 */
export async function applicationRoutes(fastify: FastifyInstance) {
  // POST /api/apply/vendor — vendor or home chef
  fastify.post("/api/apply/vendor", async (request, reply) => {
    const parsed = vendorSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const data = parsed.data;

    const applicantType = data.isHomeChef ? "home_chef" : "vendor";

    await db.insert(joinApplication).values({
      applicantType,
      businessName: data.businessName,
      contactName: data.contactName,
      contactEmail: data.contactEmail.toLowerCase(),
      contactPhone: data.contactPhone,
      location: data.location ?? null,
      cuisineTypes: data.cuisineTypes ?? null,
      kitchenBio: data.kitchenBio ?? null,
      applicationStatus: "pending",
    });

    try {
      await sendNewApplicationAlert({
        applicantType,
        contactName: data.contactName,
        contactEmail: data.contactEmail.toLowerCase(),
        contactPhone: data.contactPhone,
        businessName: data.businessName,
        location: data.location ?? null,
      });
    } catch (err) {
      fastify.log.error(err, "Failed to send new application admin alert (vendor)");
    }

    return reply.status(201).send({ success: true, message: RECEIVED_MESSAGE });
  });

  // POST /api/apply/rider — single rider
  fastify.post("/api/apply/rider", async (request, reply) => {
    const parsed = riderSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const data = parsed.data;

    await db.insert(joinApplication).values({
      applicantType: "single_rider",
      contactName: data.contactName,
      contactEmail: data.contactEmail.toLowerCase(),
      contactPhone: data.contactPhone,
      vehicleType: data.vehicleType ?? null,
      vehiclePlate: data.vehiclePlate ?? null,
      location: data.location ?? null,
      applicationStatus: "pending",
    });

    try {
      await sendNewApplicationAlert({
        applicantType: "single_rider",
        contactName: data.contactName,
        contactEmail: data.contactEmail.toLowerCase(),
        contactPhone: data.contactPhone,
        location: data.location ?? null,
      });
    } catch (err) {
      fastify.log.error(err, "Failed to send new application admin alert (rider)");
    }

    return reply.status(201).send({ success: true, message: RECEIVED_MESSAGE });
  });

  // POST /api/apply/fleet — delivery company
  fastify.post("/api/apply/fleet", async (request, reply) => {
    const parsed = fleetSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error);
    const data = parsed.data;

    await db.insert(joinApplication).values({
      applicantType: "delivery_company",
      businessName: data.companyName,
      contactName: data.contactName,
      contactEmail: data.contactEmail.toLowerCase(),
      contactPhone: data.contactPhone,
      rcNumber: data.rcNumber ?? null,
      declaredFleetSize: data.declaredFleetSize ?? null,
      operatingZones: data.operatingZones ?? null,
      applicationStatus: "pending",
    });

    try {
      await sendNewApplicationAlert({
        applicantType: "delivery_company",
        contactName: data.contactName,
        contactEmail: data.contactEmail.toLowerCase(),
        contactPhone: data.contactPhone,
        businessName: data.companyName,
      });
    } catch (err) {
      fastify.log.error(err, "Failed to send new application admin alert (fleet)");
    }

    return reply.status(201).send({ success: true, message: RECEIVED_MESSAGE });
  });
}

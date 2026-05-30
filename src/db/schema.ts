import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  decimal,
  pgEnum,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ──────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "customer",
  "chef",
  "rider",
  "admin",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "picking",
  "delivering",
  "completed",
  "cancelled",
]);

export const menuCategoryEnum = pgEnum("menu_category", [
  "mains",
  "sides",
  "desserts",
  "drinks",
  "starters",
  "specials",
]);

// ──────────────────────────────────────────────────────────────
// Better Auth Core Tables
// (better-auth will manage these via its CLI / adapter)
// ──────────────────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  // Plokitch custom fields
  role: userRoleEnum("role").notNull().default("customer"),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  address: jsonb("address").$type<{
    street: string;
    city: string;
    state: string;
    lat?: number;
    lng?: number;
  }>(),
  pushNotificationsEnabled: boolean("push_notifications_enabled").notNull().default(true),
  marketingEmailsEnabled: boolean("marketing_emails_enabled").notNull().default(false),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

// ──────────────────────────────────────────────────────────────
// Plokitch Domain Tables
// ──────────────────────────────────────────────────────────────

export const vendor = pgTable("vendor", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  description: text("description"),
  cuisineType: text("cuisine_type"),
  specialty: text("specialty"),
  tag: text("tag"),
  imageUrl: text("image_url"),
  bannerUrl: text("banner_url"),
  location: jsonb("location").$type<{
    address: string;
    city: string;
    state: string;
    lat?: number;
    lng?: number;
  }>(),
  rating: decimal("rating", { precision: 3, scale: 2 }).default("0.00"),
  totalReviews: integer("total_reviews").default(0),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).default("10.00"),
  isActive: boolean("is_active").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  deliveryTime: text("delivery_time").default("30-45 min"),
  minOrder: decimal("min_order", { precision: 10, scale: 2 }).default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  slug: text("slug").unique(),
});

export const menuItem = pgTable("menu_item", {
  id: uuid("id").defaultRandom().primaryKey(),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendor.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  category: menuCategoryEnum("category").notNull().default("mains"),
  imageUrl: text("image_url"),
  ingredients: jsonb("ingredients").$type<string[]>().default([]),
  prepTime: text("prep_time"),
  tag: text("tag"),
  rating: decimal("rating", { precision: 3, scale: 2 }).default("0.00"),
  isAvailable: boolean("is_available").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const order = pgTable("order", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => user.id),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendor.id),
  riderId: text("rider_id").references(() => user.id),
  items: jsonb("items")
    .notNull()
    .$type<
      Array<{
        menuItemId: string;
        name: string;
        price: number;
        quantity: number;
      }>
    >(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }).default("0"),
  status: orderStatusEnum("status").notNull().default("pending"),
  deliveryAddress: jsonb("delivery_address").$type<{
    street: string;
    city: string;
    state: string;
    instructions?: string;
    lat?: number;
    lng?: number;
  }>(),
  // Explicit coordinate columns for map queries
  pickupLat: decimal("pickup_lat", { precision: 10, scale: 7 }),
  pickupLng: decimal("pickup_lng", { precision: 10, scale: 7 }),
  deliveryLat: decimal("delivery_lat", { precision: 10, scale: 7 }),
  deliveryLng: decimal("delivery_lng", { precision: 10, scale: 7 }),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  paymentRef: text("payment_ref"),
  notes: text("notes"),
  estimatedDelivery: timestamp("estimated_delivery"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  isPriority: boolean("is_priority").default(false),
});

export const review = pgTable("review", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: text("customer_id")
    .notNull()
    .references(() => user.id),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendor.id),
  orderId: uuid("order_id")
    .notNull()
    .references(() => order.id),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const favoriteVendor = pgTable("favorite_vendor", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendor.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const riderProfile = pgTable("rider_profile", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  vehicleType: text("vehicle_type"),
  plateNumber: text("plate_number"),
  isAvailable: boolean("is_available").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  currentLocation: jsonb("current_location").$type<{
    lat: number;
    lng: number;
  }>(),
  totalDeliveries: integer("total_deliveries").default(0),
  totalEarnings: decimal("total_earnings", { precision: 12, scale: 2 }).default("0"),
  rating: decimal("rating", { precision: 3, scale: 2 }).default("0.00"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const complaint = pgTable("complaint", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .references(() => order.id),
  customerId: text("customer_id")
    .notNull()
    .references(() => user.id),
  vendorId: uuid("vendor_id")
    .references(() => vendor.id),
  riderId: text("rider_id")
    .references(() => user.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"), // open, in-progress, resolved, closed
  priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
  category: text("category").notNull().default("general"), // delivery, quality, missing_item, payment, etc
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminId: text("admin_id").notNull(), // User ID of the admin who performed the action
  action: text("action").notNull(), // e.g., 'update_vendor_status', 'approve_payout'
  entityType: text("entity_type").notNull(), // e.g., 'vendor', 'order', 'payout'
  entityId: text("entity_id"),
  oldData: jsonb("old_data"),
  newData: jsonb("new_data"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ──────────────────────────────────────────────────────────────
// Relations
// ──────────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ one, many }) => ({
  vendor: one(vendor, { fields: [user.id], references: [vendor.userId] }),
  riderProfile: one(riderProfile, { fields: [user.id], references: [riderProfile.userId] }),
  ordersAsCustomer: many(order, { relationName: "customerOrders" }),
  ordersAsRider: many(order, { relationName: "riderDeliveries" }),
  reviews: many(review),
  favorites: many(favoriteVendor),
}));

export const vendorRelations = relations(vendor, ({ one, many }) => ({
  user: one(user, { fields: [vendor.userId], references: [user.id] }),
  menuItems: many(menuItem),
  orders: many(order),
  reviews: many(review),
  favoritedBy: many(favoriteVendor),
}));

export const menuItemRelations = relations(menuItem, ({ one }) => ({
  vendor: one(vendor, { fields: [menuItem.vendorId], references: [vendor.id] }),
}));

export const orderRelations = relations(order, ({ one }) => ({
  customer: one(user, {
    fields: [order.customerId],
    references: [user.id],
    relationName: "customerOrders",
  }),
  vendor: one(vendor, { fields: [order.vendorId], references: [vendor.id] }),
  rider: one(user, {
    fields: [order.riderId],
    references: [user.id],
    relationName: "riderDeliveries",
  }),
  review: one(review, { fields: [order.id], references: [review.orderId] }),
}));

export const reviewRelations = relations(review, ({ one }) => ({
  customer: one(user, { fields: [review.customerId], references: [user.id] }),
  vendor: one(vendor, { fields: [review.vendorId], references: [vendor.id] }),
  order: one(order, { fields: [review.orderId], references: [order.id] }),
}));

export const riderProfileRelations = relations(riderProfile, ({ one }) => ({
  user: one(user, { fields: [riderProfile.userId], references: [user.id] }),
}));

export const favoriteVendorRelations = relations(favoriteVendor, ({ one }) => ({
  user: one(user, { fields: [favoriteVendor.userId], references: [user.id] }),
  vendor: one(vendor, { fields: [favoriteVendor.vendorId], references: [vendor.id] }),
}));

export const complaintRelations = relations(complaint, ({ one }) => ({
  customer: one(user, { fields: [complaint.customerId], references: [user.id] }),
  order: one(order, { fields: [complaint.orderId], references: [order.id] }),
  vendor: one(vendor, { fields: [complaint.vendorId], references: [vendor.id] }),
  rider: one(user, { fields: [complaint.riderId], references: [user.id] }),
}));

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
  "company_rider",
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

export const riderTypeEnum = pgEnum("rider_type", ["single", "company"]);

export const applicationStatusEnum = pgEnum("application_status", [
  "pending",
  "approved",
  "rejected",
]);

export const applicantTypeEnum = pgEnum("applicant_type", [
  "vendor",
  "home_chef",
  "single_rider",
  "delivery_company",
]);

// Wallet / ledger / payout enums
export const ledgerTypeEnum = pgEnum("ledger_type", ["credit", "debit"]);

export const ledgerCategoryEnum = pgEnum("ledger_category", [
  "delivery_earning", // rider earns the delivery fee on completion
  "order_revenue", // vendor earns item revenue (net of commission) on completion
  "commission", // platform commission deducted (informational)
  "payout", // funds withdrawn to a bank account
  "payout_reversal", // a failed/rejected payout returned to the wallet
  "adjustment", // manual admin correction
]);

export const payoutStatusEnum = pgEnum("payout_status", [
  "pending", // requested, awaiting admin/processor
  "processing", // submitted to Paystack transfer
  "paid", // settled successfully
  "failed", // could not be settled (wallet re-credited)
  "cancelled", // withdrawn by the requester before processing
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

export const invite = pgTable("invite", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("active"),
  // For fleet sub-rider invites: the company this rider will belong to. When
  // set on a role="rider" invite, accept-invite creates a company sub-rider.
  companyId: uuid("company_id").references(() => deliveryCompany.id, {
    onDelete: "cascade",
  }),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Platform-wide key/value settings (singleton-style flags). e.g.
// key "auto_dispatch" → { enabled: boolean } for global auto-dispatch.
export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  // When true, orders are broadcast to all online riders automatically the
  // moment they're marked ready (no manual "Dispatch" press required).
  autoDispatch: boolean("auto_dispatch").notNull().default(false),
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
  // Targeted dispatch offer: while offerExpiresAt is in the future the order is
  // reserved for offeredRiderId (hidden from the open pool). On expiry/decline
  // it is broadcast globally to all online riders. dispatchedAt marks when the
  // order was first broadcast (manual or auto).
  offeredRiderId: text("offered_rider_id").references(() => user.id),
  offerExpiresAt: timestamp("offer_expires_at"),
  dispatchedAt: timestamp("dispatched_at"),
  notes: text("notes"),
  estimatedDelivery: timestamp("estimated_delivery"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  isPriority: boolean("is_priority").default(false),
});

// In-app notifications. Persisted for a feed + unread count; realtime delivery
// is layered on top via Supabase Realtime broadcast on a per-user channel.
export const notification = pgTable("notification", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Recipient (Better Auth user id).
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // e.g. order_placed | order_status | delivery_offer | offer_expired |
  // order_assigned | payout. Kept as text so new types don't require migrations.
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  orderId: uuid("order_id").references(() => order.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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

// A delivery company / fleet operator. One owner account per company.
export const deliveryCompany = pgTable("delivery_company", {
  id: uuid("id").defaultRandom().primaryKey(),
  // FK to Better Auth users (text id) — the company owner account.
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone").notNull(),
  rcNumber: text("rc_number"),
  fleetSize: integer("fleet_size").default(0),
  applicationStatus: applicationStatusEnum("application_status")
    .notNull()
    .default("pending"),
  approvedAt: timestamp("approved_at"),
  // FK to Better Auth users (text id) — the admin who approved.
  approvedBy: text("approved_by").references(() => user.id),
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
  // Connection heartbeat: rider is considered "online" only when isAvailable
  // AND lastSeenAt is within the freshness window (see RIDER_ONLINE_WINDOW_MS).
  lastSeenAt: timestamp("last_seen_at"),
  currentLocation: jsonb("current_location").$type<{
    lat: number;
    lng: number;
  }>(),
  totalDeliveries: integer("total_deliveries").default(0),
  totalEarnings: decimal("total_earnings", { precision: 12, scale: 2 }).default("0"),
  rating: decimal("rating", { precision: 3, scale: 2 }).default("0.00"),
  // Fleet model: "single" = independent rider, "company" = sub-rider of a fleet.
  riderType: riderTypeEnum("rider_type").notNull().default("single"),
  // null = independent single rider; set = sub-rider belonging to a company.
  companyId: uuid("company_id").references(() => deliveryCompany.id, {
    onDelete: "set null",
  }),
  applicationStatus: applicationStatusEnum("application_status")
    .notNull()
    .default("pending"),
  approvedAt: timestamp("approved_at"),
  approvedBy: text("approved_by").references(() => user.id),
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

// Public applications from the "Join Us" page, captured BEFORE a Better Auth
// account exists. Admin reviews these, then triggers an invite that creates the
// actual operator account (vendor / rider / company).
export const joinApplication = pgTable("join_application", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicantType: applicantTypeEnum("applicant_type").notNull(),
  businessName: text("business_name"),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone").notNull(),
  location: text("location"),
  cuisineTypes: text("cuisine_types").array(),
  kitchenBio: text("kitchen_bio"),
  vehicleType: text("vehicle_type"),
  vehiclePlate: text("vehicle_plate"),
  rcNumber: text("rc_number"),
  declaredFleetSize: integer("declared_fleet_size"),
  operatingZones: text("operating_zones").array(),
  applicationStatus: applicationStatusEnum("application_status")
    .notNull()
    .default("pending"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by").references(() => user.id),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ──────────────────────────────────────────────────────────────
// Wallet / Ledger / Payouts
// ──────────────────────────────────────────────────────────────

// One wallet per earning user (rider, vendor/chef, or fleet owner).
export const wallet = pgTable("wallet", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  // Available-to-withdraw balance.
  balance: decimal("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  // Lifetime gross credited (for reporting).
  totalEarned: decimal("total_earned", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("NGN"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Append-only ledger of every wallet movement.
export const ledgerEntry = pgTable("ledger_entry", {
  id: uuid("id").defaultRandom().primaryKey(),
  walletId: uuid("wallet_id")
    .notNull()
    .references(() => wallet.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: ledgerTypeEnum("type").notNull(),
  category: ledgerCategoryEnum("category").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  // Wallet balance immediately after this entry was applied.
  balanceAfter: decimal("balance_after", { precision: 12, scale: 2 }).notNull(),
  orderId: uuid("order_id").references(() => order.id, { onDelete: "set null" }),
  payoutId: uuid("payout_id"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// A saved bank destination for payouts (Paystack transfer recipient).
export const transferRecipient = pgTable("transfer_recipient", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  bankName: text("bank_name").notNull(),
  bankCode: text("bank_code").notNull(),
  accountNumber: text("account_number").notNull(),
  accountName: text("account_name").notNull(),
  // Paystack recipient code (RCP_...), null until/if created remotely.
  paystackRecipientCode: text("paystack_recipient_code"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// A withdrawal of wallet funds to a transfer recipient.
export const payout = pgTable("payout", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  walletId: uuid("wallet_id")
    .notNull()
    .references(() => wallet.id, { onDelete: "cascade" }),
  transferRecipientId: uuid("transfer_recipient_id").references(() => transferRecipient.id, {
    onDelete: "set null",
  }),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  status: payoutStatusEnum("status").notNull().default("pending"),
  reference: text("reference").notNull().unique(),
  paystackTransferCode: text("paystack_transfer_code"),
  failureReason: text("failure_reason"),
  // Snapshot of the destination so history survives recipient deletion.
  destinationBankName: text("destination_bank_name"),
  destinationAccountNumber: text("destination_account_number"),
  destinationAccountName: text("destination_account_name"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  company: one(deliveryCompany, {
    fields: [riderProfile.companyId],
    references: [deliveryCompany.id],
  }),
}));

export const deliveryCompanyRelations = relations(deliveryCompany, ({ one, many }) => ({
  owner: one(user, { fields: [deliveryCompany.userId], references: [user.id] }),
  riders: many(riderProfile),
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

-- Create Solvix delivery status enum
CREATE TYPE "solvix_status" AS ENUM ('pending', 'assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled');

-- Add Solvix delivery tracking columns to order table
ALTER TABLE "order" ADD COLUMN "solvix_delivery_id" text;
ALTER TABLE "order" ADD COLUMN "solvix_status" "solvix_status";
ALTER TABLE "order" ADD COLUMN "solvix_rider_name" text;

-- Index on solvix_delivery_id for fast webhook lookups
CREATE INDEX "idx_order_solvix_delivery_id" ON "order" ("solvix_delivery_id");

CREATE TYPE "public"."applicant_type" AS ENUM('vendor', 'home_chef', 'single_rider', 'delivery_company');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."rider_type" AS ENUM('single', 'company');--> statement-breakpoint
CREATE TABLE "delivery_company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text NOT NULL,
	"rc_number" text,
	"fleet_size" integer DEFAULT 0,
	"application_status" "application_status" DEFAULT 'pending' NOT NULL,
	"approved_at" timestamp,
	"approved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "join_application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_type" "applicant_type" NOT NULL,
	"business_name" text,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text NOT NULL,
	"location" text,
	"cuisine_types" text[],
	"kitchen_bio" text,
	"vehicle_type" text,
	"vehicle_plate" text,
	"rc_number" text,
	"declared_fleet_size" integer,
	"operating_zones" text[],
	"application_status" "application_status" DEFAULT 'pending' NOT NULL,
	"reviewed_at" timestamp,
	"reviewed_by" text,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invite" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "rider_profile" ADD COLUMN "rider_type" "rider_type" DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "rider_profile" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "rider_profile" ADD COLUMN "application_status" "application_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "rider_profile" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "rider_profile" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "delivery_company" ADD CONSTRAINT "delivery_company_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_company" ADD CONSTRAINT "delivery_company_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_application" ADD CONSTRAINT "join_application_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_profile" ADD CONSTRAINT "rider_profile_company_id_delivery_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."delivery_company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_profile" ADD CONSTRAINT "rider_profile_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
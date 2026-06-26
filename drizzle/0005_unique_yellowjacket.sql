ALTER TABLE "order" ADD COLUMN "offered_rider_id" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "offer_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "dispatched_at" timestamp;--> statement-breakpoint
ALTER TABLE "vendor" ADD COLUMN "auto_dispatch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_offered_rider_id_user_id_fk" FOREIGN KEY ("offered_rider_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
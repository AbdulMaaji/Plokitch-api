ALTER TABLE "menu_item" ADD COLUMN "is_add_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "login_notifications_enabled" boolean DEFAULT true NOT NULL;
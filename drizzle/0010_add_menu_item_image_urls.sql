-- Add JSONB column for multiple menu item images
ALTER TABLE "menu_item" ADD COLUMN "image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

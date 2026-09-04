ALTER TABLE "factory_settings" ADD COLUMN "shifts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_ticks" ADD COLUMN "wage_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_work_centers" ADD COLUMN "wage_cents_per_hour" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "wage_cents_per_hour" integer DEFAULT 0 NOT NULL;
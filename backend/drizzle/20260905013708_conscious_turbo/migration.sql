ALTER TABLE "factory_settings" ADD COLUMN "release_policy" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_settings" ADD COLUMN "wip_cap" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_settings" ADD COLUMN "release_lead_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_settings" ADD COLUMN "drum_work_center_id" integer;--> statement-breakpoint
ALTER TABLE "factory_settings" ADD COLUMN "drum_buffer" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN "release_policy" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN "wip_cap" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN "release_lead_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN "drum_work_center_id" integer;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN "drum_buffer" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_settings" ADD CONSTRAINT "factory_settings_drum_work_center_id_work_centers_id_fkey" FOREIGN KEY ("drum_work_center_id") REFERENCES "work_centers"("id") ON DELETE SET NULL;
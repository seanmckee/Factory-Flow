CREATE TABLE "factory_settings" (
	"id" integer PRIMARY KEY,
	"facility_overhead_cents_per_day" integer DEFAULT 0 NOT NULL,
	"wip_carrying_bps_per_day" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_ticks" ADD COLUMN "operating_expense_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_ticks" ADD COLUMN "carrying_cost_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_work_centers" ADD COLUMN "standing_cost_cents_per_day" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN "day_ticks" integer DEFAULT 28800 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN "facility_overhead_cents_per_day" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN "wip_carrying_bps_per_day" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD COLUMN "carry_remainder" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "standing_cost_cents_per_day" integer DEFAULT 0 NOT NULL;
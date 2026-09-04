CREATE TABLE "run_scrapped_parts" (
	"id" serial PRIMARY KEY,
	"run_id" integer NOT NULL,
	"part_uuid" uuid NOT NULL,
	"work_order_id" integer NOT NULL,
	"unit_index" integer NOT NULL,
	"released_at_tick" integer NOT NULL,
	"scrapped_at_tick" integer NOT NULL,
	"sequence" integer NOT NULL,
	"work_center_id" integer NOT NULL,
	"material_cost_cents" integer NOT NULL,
	CONSTRAINT "run_scrapped_parts_run_id_part_uuid_unique" UNIQUE("run_id","part_uuid")
);
--> statement-breakpoint
ALTER TABLE "routing_steps" ADD COLUMN "scrap_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_work_order_steps" ADD COLUMN "setup_time_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_work_order_steps" ADD COLUMN "scrap_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_work_order_steps" ADD COLUMN "setup_started_at_tick" integer;--> statement-breakpoint
CREATE INDEX "run_scrapped_parts_run_id_scrapped_at_tick_id_idx" ON "run_scrapped_parts" ("run_id","scrapped_at_tick","id");--> statement-breakpoint
ALTER TABLE "run_scrapped_parts" ADD CONSTRAINT "run_scrapped_parts_run_id_simulation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_scrapped_parts" ADD CONSTRAINT "run_scrapped_parts_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT;
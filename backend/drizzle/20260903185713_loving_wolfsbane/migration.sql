CREATE TABLE "run_finished_parts" (
	"id" serial PRIMARY KEY,
	"run_id" integer NOT NULL,
	"part_uuid" uuid NOT NULL,
	"work_order_id" integer NOT NULL,
	"released_at_tick" integer NOT NULL,
	"completed_at_tick" integer NOT NULL,
	"throughput_cents" integer NOT NULL,
	"sales_order_id" integer,
	"unit_price_cents" integer,
	"material_cost_cents" integer NOT NULL,
	CONSTRAINT "run_finished_parts_run_id_part_uuid_unique" UNIQUE("run_id","part_uuid")
);
--> statement-breakpoint
CREATE TABLE "run_released_orders" (
	"run_id" integer,
	"work_order_id" integer,
	"routing_id" integer NOT NULL,
	"routing_revision" varchar(255) NOT NULL,
	CONSTRAINT "run_released_orders_pkey" PRIMARY KEY("run_id","work_order_id")
);
--> statement-breakpoint
CREATE TABLE "run_tick_work_centers" (
	"run_id" integer,
	"tick_num" integer,
	"work_center_id" integer,
	"busy" integer NOT NULL,
	"queued" integer NOT NULL,
	CONSTRAINT "run_tick_work_centers_pkey" PRIMARY KEY("run_id","tick_num","work_center_id")
);
--> statement-breakpoint
CREATE TABLE "run_ticks" (
	"run_id" integer,
	"tick_num" integer,
	"throughput_cents" integer NOT NULL,
	"wip_count" integer NOT NULL,
	CONSTRAINT "run_ticks_pkey" PRIMARY KEY("run_id","tick_num")
);
--> statement-breakpoint
CREATE TABLE "run_wip_parts" (
	"id" serial PRIMARY KEY,
	"run_id" integer NOT NULL,
	"part_uuid" uuid NOT NULL,
	"work_order_id" integer NOT NULL,
	"released_at_tick" integer NOT NULL,
	"step_index" integer NOT NULL,
	"progress_seconds" integer DEFAULT 0 NOT NULL,
	"actual_process_time_seconds" integer NOT NULL,
	CONSTRAINT "run_wip_parts_run_id_part_uuid_unique" UNIQUE("run_id","part_uuid")
);
--> statement-breakpoint
CREATE TABLE "run_work_centers" (
	"run_id" integer,
	"work_center_id" integer,
	"capacity" integer NOT NULL,
	CONSTRAINT "run_work_centers_pkey" PRIMARY KEY("run_id","work_center_id")
);
--> statement-breakpoint
CREATE TABLE "run_work_order_steps" (
	"run_id" integer,
	"work_order_id" integer,
	"sequence" integer,
	"work_center_id" integer NOT NULL,
	"process_time_seconds" integer NOT NULL,
	CONSTRAINT "run_work_order_steps_pkey" PRIMARY KEY("run_id","work_order_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "simulation_runs" (
	"id" serial PRIMARY KEY,
	"name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'idle' NOT NULL,
	"tick_num" integer DEFAULT 0 NOT NULL,
	"rng_seed" integer NOT NULL,
	"parent_run_id" integer,
	"forked_at_tick" integer
);
--> statement-breakpoint
CREATE INDEX "run_finished_parts_run_id_completed_at_tick_id_idx" ON "run_finished_parts" ("run_id","completed_at_tick","id");--> statement-breakpoint
ALTER TABLE "run_finished_parts" ADD CONSTRAINT "run_finished_parts_run_id_simulation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_finished_parts" ADD CONSTRAINT "run_finished_parts_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "run_finished_parts" ADD CONSTRAINT "run_finished_parts_sales_order_id_sales_orders_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "run_released_orders" ADD CONSTRAINT "run_released_orders_run_id_simulation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_released_orders" ADD CONSTRAINT "run_released_orders_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "run_tick_work_centers" ADD CONSTRAINT "run_tick_work_centers_run_id_tick_num_run_ticks_fkey" FOREIGN KEY ("run_id","tick_num") REFERENCES "run_ticks"("run_id","tick_num") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_ticks" ADD CONSTRAINT "run_ticks_run_id_simulation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_wip_parts" ADD CONSTRAINT "run_wip_parts_run_id_simulation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_wip_parts" ADD CONSTRAINT "run_wip_parts_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "run_work_centers" ADD CONSTRAINT "run_work_centers_run_id_simulation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_work_order_steps" ADD CONSTRAINT "run_work_order_steps_run_id_simulation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_work_order_steps" ADD CONSTRAINT "run_work_order_steps_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_parent_run_id_simulation_runs_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "simulation_runs"("id") ON DELETE RESTRICT;
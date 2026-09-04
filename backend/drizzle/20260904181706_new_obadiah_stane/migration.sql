CREATE TABLE "run_capital_actions" (
	"id" serial PRIMARY KEY,
	"run_id" integer NOT NULL,
	"kind" varchar(30) NOT NULL,
	"work_center_id" integer NOT NULL,
	"applied_at_tick" integer NOT NULL,
	"spend_cents" integer NOT NULL,
	"machines_after" integer NOT NULL,
	"operators_after" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_tick_work_centers" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "run_work_centers" ADD COLUMN "operators" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_work_centers" ADD COLUMN "standing_cost_effective_from_tick" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_work_centers" ADD COLUMN "wage_effective_from_tick" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_work_centers" ADD COLUMN "machine_purchase_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_work_centers" ADD COLUMN "machine_salvage_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_work_centers" ADD COLUMN "operator_hire_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "operators" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "machine_purchase_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "machine_salvage_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_centers" ADD COLUMN "operator_hire_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "run_capital_actions_run_id_applied_at_tick_id_idx" ON "run_capital_actions" ("run_id","applied_at_tick","id");--> statement-breakpoint
ALTER TABLE "run_capital_actions" ADD CONSTRAINT "run_capital_actions_run_id_simulation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Hand-added: operators backfill to the machine count, not to the column
-- default of 1. Operators = capacity was 6D's stated assumption (the wage
-- bill was `capacity × rate`), so a centre with two machines has to keep
-- accruing two operators' wages and keep its effective capacity; defaulting
-- it to 1 would silently halve both, on the live factory and inside every run
-- already created.
UPDATE "work_centers" SET "operators" = "capacity";--> statement-breakpoint
UPDATE "run_work_centers" SET "operators" = "capacity";
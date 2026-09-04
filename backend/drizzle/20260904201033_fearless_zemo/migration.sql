CREATE TABLE "run_buckets" (
	"run_id" integer,
	"start_tick" integer,
	"tick_count" integer NOT NULL,
	"throughput_cents" integer NOT NULL,
	"operating_expense_cents" integer DEFAULT 0 NOT NULL,
	"carrying_cost_cents" integer DEFAULT 0 NOT NULL,
	"wage_cents" integer DEFAULT 0 NOT NULL,
	"wip_part_ticks" integer DEFAULT 0 NOT NULL,
	"max_wip" integer DEFAULT 0 NOT NULL,
	"end_wip" integer NOT NULL,
	CONSTRAINT "run_buckets_pkey" PRIMARY KEY("run_id","start_tick")
);
--> statement-breakpoint
CREATE TABLE "run_bucket_work_centers" (
	"run_id" integer,
	"start_tick" integer,
	"work_center_id" integer,
	"observed_ticks" integer NOT NULL,
	"busy_machine_ticks" integer NOT NULL,
	"capacity_ticks" integer NOT NULL,
	"queued_part_ticks" integer NOT NULL,
	"max_queue_depth" integer NOT NULL,
	CONSTRAINT "run_bucket_work_centers_pkey" PRIMARY KEY("run_id","start_tick","work_center_id")
);
--> statement-breakpoint

-- Hand-added, like 6E.1's operators backfill: **carry the existing rows over
-- rather than dropping them**. A finished run's series is history, and the
-- whole claim of the bucket change is that the resolution is a storage choice
-- which costs no reported figure — so the migration had better be able to
-- demonstrate that on real data instead of starting from an empty table.
--
-- The grid is `((tick_num - 1) / 60) * 60 + 1`, the same expression
-- `bucketStartTick` computes in TypeScript. Integer division truncates in
-- Postgres, which is the floor for the positive tick numbers involved.
INSERT INTO "run_buckets" (
	"run_id", "start_tick", "tick_count", "throughput_cents",
	"operating_expense_cents", "carrying_cost_cents", "wage_cents",
	"wip_part_ticks", "max_wip", "end_wip"
)
SELECT
	"run_id",
	(("tick_num" - 1) / 60) * 60 + 1,
	count(*)::int,
	sum("throughput_cents")::int,
	sum("operating_expense_cents")::int,
	sum("carrying_cost_cents")::int,
	sum("wage_cents")::int,
	-- WIP's three shapes: the mean's numerator, the peak, and the closing
	-- level. The last is the newest tick's value, which is the same array_agg
	-- ordering trick the bucketed `/ticks` read already used.
	sum("wip_count")::int,
	max("wip_count")::int,
	(array_agg("wip_count" ORDER BY "tick_num" DESC))[1]
FROM "run_ticks"
GROUP BY "run_id", (("tick_num" - 1) / 60) * 60 + 1;
--> statement-breakpoint

-- `capacity` was nullable, meaning "pre-6E": such a run could not change
-- capacity at all, so the run's frozen effective capacity — `least(machines,
-- operators)`, the same min the loader takes — is what it was throughout. That
-- is exactly the fallback the read side used to apply per row, resolved here
-- once so `capacity_ticks` can be NOT NULL and no reader needs the rule again.
INSERT INTO "run_bucket_work_centers" (
	"run_id", "start_tick", "work_center_id", "observed_ticks",
	"busy_machine_ticks", "capacity_ticks", "queued_part_ticks", "max_queue_depth"
)
SELECT
	tw."run_id",
	((tw."tick_num" - 1) / 60) * 60 + 1,
	tw."work_center_id",
	count(*)::int,
	sum(tw."busy")::int,
	sum(coalesce(tw."capacity", least(rwc."capacity", rwc."operators"), 0))::int,
	sum(tw."queued")::int,
	max(tw."queued")::int
FROM "run_tick_work_centers" tw
LEFT JOIN "run_work_centers" rwc
	ON rwc."run_id" = tw."run_id"
	AND rwc."work_center_id" = tw."work_center_id"
GROUP BY tw."run_id", ((tw."tick_num" - 1) / 60) * 60 + 1, tw."work_center_id";
--> statement-breakpoint

ALTER TABLE "run_buckets" ADD CONSTRAINT "run_buckets_run_id_simulation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "simulation_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_bucket_work_centers" ADD CONSTRAINT "run_bucket_work_centers_run_id_start_tick_run_buckets_fkey" FOREIGN KEY ("run_id","start_tick") REFERENCES "run_buckets"("run_id","start_tick") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_tick_work_centers" DROP CONSTRAINT "run_tick_work_centers_run_id_tick_num_run_ticks_fkey";--> statement-breakpoint
DROP TABLE "run_tick_work_centers";--> statement-breakpoint
DROP TABLE "run_ticks";

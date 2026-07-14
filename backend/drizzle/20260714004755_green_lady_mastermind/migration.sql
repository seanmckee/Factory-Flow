CREATE TABLE "routing_steps" (
	"id" serial PRIMARY KEY,
	"routing_id" integer NOT NULL,
	"work_center_id" integer NOT NULL,
	"sequence" integer NOT NULL,
	"process_time_seconds" integer NOT NULL,
	"setup_time_seconds" integer NOT NULL,
	CONSTRAINT "routing_steps_routing_id_sequence_unique" UNIQUE("routing_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "routings" (
	"id" serial PRIMARY KEY,
	"part_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"revision" varchar(255) DEFAULT 'A' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_routing_id_routings_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "routings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_work_center_id_work_centers_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "work_centers"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "routings" ADD CONSTRAINT "routings_part_id_parts_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE;
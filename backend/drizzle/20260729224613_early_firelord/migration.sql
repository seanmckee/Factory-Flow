CREATE TABLE "allocations" (
	"id" serial PRIMARY KEY,
	"sales_order_id" integer NOT NULL,
	"work_order_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "allocations_sales_order_id_work_order_id_unique" UNIQUE("sales_order_id","work_order_id")
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" serial PRIMARY KEY,
	"part_number" varchar(255) NOT NULL UNIQUE,
	"name" varchar(255) NOT NULL,
	"material_cost_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "sales_orders" (
	"id" serial PRIMARY KEY,
	"part_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"order_number" varchar(255) NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE "work_centers" (
	"id" serial PRIMARY KEY,
	"name" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" serial PRIMARY KEY,
	"part_id" integer NOT NULL,
	"routing_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"order_number" varchar(255) NOT NULL UNIQUE,
	"status" varchar(20) DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_sales_order_id_sales_orders_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_routing_id_routings_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "routings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "routing_steps" ADD CONSTRAINT "routing_steps_work_center_id_work_centers_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "work_centers"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "routings" ADD CONSTRAINT "routings_part_id_parts_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_part_id_parts_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_part_id_parts_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_routing_id_routings_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "routings"("id") ON DELETE RESTRICT;
CREATE TABLE "work_orders" (
	"id" serial PRIMARY KEY,
	"part_id" integer,
	"routing_id" integer,
	"quantity" integer NOT NULL,
	"order_number" varchar(255) NOT NULL UNIQUE,
	"status" varchar(20) DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_part_id_parts_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_routing_id_routings_id_fkey" FOREIGN KEY ("routing_id") REFERENCES "routings"("id") ON DELETE RESTRICT;
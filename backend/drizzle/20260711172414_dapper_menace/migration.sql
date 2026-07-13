CREATE TABLE "parts" (
	"id" serial PRIMARY KEY,
	"part_number" varchar(255) NOT NULL UNIQUE,
	"name" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_centers" (
	"id" serial PRIMARY KEY,
	"name" varchar(255) NOT NULL
);

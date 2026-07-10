import { integer, pgTable, varchar, serial } from "drizzle-orm/pg-core";

export const workCenters = pgTable("work_centers", {
  id: serial("id").primaryKey(),
  name: varchar({ length: 255 }).notNull(),
});

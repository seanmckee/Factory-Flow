import { integer, pgTable, varchar, serial, unique } from "drizzle-orm/pg-core";

export const workCenters = pgTable("work_centers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
});

export const parts = pgTable("parts", {
  id: serial("id").primaryKey(),
  partNumber: varchar("part_number", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  materialCostCents: integer("material_cost_cents").notNull(),
});

export const routings = pgTable("routings", {
  id: serial("id").primaryKey(),
  partId: integer("part_id")
    .references(() => parts.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  revision: varchar("revision", { length: 255 }).notNull().default("A"),
});

export const routingSteps = pgTable(
  "routing_steps",
  {
    id: serial("id").primaryKey(),
    routingId: integer("routing_id")
      .references(() => routings.id, {
        onDelete: "cascade",
      })
      .notNull(),
    workCenterId: integer("work_center_id")
      .references(() => workCenters.id, {
        onDelete: "restrict",
      })
      .notNull(),
    sequence: integer("sequence").notNull(),
    processTimeSeconds: integer("process_time_seconds").notNull(),
    setupTimeSeconds: integer("setup_time_seconds").notNull(),
  },
  (table) => [unique().on(table.routingId, table.sequence)],
);

export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  partId: integer("part_id")
    .references(() => parts.id, {
      onDelete: "restrict",
    })
    .notNull(),
  routingId: integer("routing_id")
    .references(() => routings.id, {
      onDelete: "restrict",
    })
    .notNull(),
  quantity: integer("quantity").notNull(),
  orderNumber: varchar("order_number", { length: 255 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
});

export const salesOrders = pgTable("sales_orders", {
  id: serial("id").primaryKey(),
  partId: integer("part_id")
    .references(() => parts.id, {
      onDelete: "restrict",
    })
    .notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  orderNumber: varchar("order_number", { length: 255 }).notNull().unique(),
});

export const allocations = pgTable(
  "allocations",
  {
    id: serial("id").primaryKey(),
    salesOrderId: integer("sales_order_id")
      .references(() => salesOrders.id, {
        onDelete: "cascade",
      })
      .notNull(),
    workOrderId: integer("work_order_id")
      .references(() => workOrders.id, {
        onDelete: "cascade",
      })
      .notNull(),
    quantity: integer("quantity").notNull(),
  },

  (table) => [unique().on(table.salesOrderId, table.workOrderId)],
);

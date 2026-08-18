import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import dotenv from "dotenv";

dotenv.config();

// The neon-http driver throws "No transactions support" on db.transaction(),
// so writes that span tables (work order + its allocations) need the WebSocket
// pool instead. Node's global WebSocket is picked up automatically.
const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 5 });

export const db = drizzle({ client: pool });

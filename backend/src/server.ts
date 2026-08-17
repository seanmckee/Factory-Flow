import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import partsRouter from "./routes/parts.js";
import workCentersRouter from "./routes/workCenters.js";
import routingsRouter from "./routes/routings.js";
import workOrderRouter from "./routes/workOrders.js";
import salesOrderRouter from "./routes/salesOrders.js";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/parts", partsRouter);
app.use("/api/work-centers", workCentersRouter);
app.use("/api/routings", routingsRouter);
app.use("/api/work-orders", workOrderRouter);
app.use("/api/sales-orders", salesOrderRouter);

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});

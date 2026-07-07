import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/factory", (_req, res) => {
  res.json({
    machines: [
      { id: "raw", name: "Raw Material" },
      { id: "cutter", name: "Cutter" },
      { id: "finisher", name: "Finisher" },
    ],
  });
});

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});

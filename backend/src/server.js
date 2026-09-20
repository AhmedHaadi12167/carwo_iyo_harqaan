require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5000",
  "https://frontend-or41bx6f3-ahmed-haadis-projects-16f527d0.vercel.app",
  "https://frontend-pearl-nine-72.vercel.app",
  "https://frontend-ukgy7hjki-ahmed-haadis-projects-16f527d0.vercel.app",
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(express.json({ limit: "8mb" })); // fabric photos travel as compressed data URLs

app.get("/api/health", (req, res) =>
  res.json({ ok: true, service: "Tailor System API" }),
);

app.use("/api/auth", require("./routes/auth"));
app.use("/api/branches", require("./routes/branches"));
app.use("/api/users", require("./routes/users"));
app.use("/api/fabrics", require("./routes/fabrics"));
app.use("/api/products", require("./routes/products"));
app.use("/api/customers", require("./routes/customers"));
app.use("/api/orders", require("./routes/orders"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/tailor", require("./routes/tailor"));
app.use("/api/finance", require("./routes/finance"));
app.use("/api/sync", require("./routes/sync"));

// 404
app.use((req, res) => res.status(404).json({ error: "Endpoint not found" }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

// Vercel needs the Express app exported
module.exports = app;

// Only start a local server when running outside Vercel
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;

  app.listen(PORT, () => {
    console.log(`Tailor System API running on http://localhost:${PORT}`);
  });

  // Auto-post rent & salaries for the current month
  const { postMonthlyRecurring } = require("./recurring");
  setTimeout(postMonthlyRecurring, 5000);
  setInterval(postMonthlyRecurring, 6 * 60 * 60 * 1000);

  // POS <-> cloud sync
  const { startSyncLoop } = require("./sync/client");
  startSyncLoop();
}

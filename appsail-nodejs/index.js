import Express from "express";
import { fileURLToPath } from "url";
import backendModule from "./backend.cjs";

const { createBackendRouter } = backendModule;

const app = Express();
const port = Number(process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 3000);
const storagePath = fileURLToPath(new URL("./data/messages.json", import.meta.url));

// Global CORS middleware at the very top
app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400"); // Cache preflight for 24h

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

app.use(
  createBackendRouter({
    storagePath,
    graphApiVersion: process.env.WA_GRAPH_API_VERSION || "v25.0",
  })
);

app.get("/", (req, res) => {
  res.json({
    service: "waba-appsail",
    ok: true,
    endpoints: [
      "/health",
      "/api/messages",
      "/api/send-message",
      "/webhook/whatsapp",
    ],
  });
});

app.listen(port, () => {
  console.log(`WABA AppSail backend listening on port ${port}`);
});

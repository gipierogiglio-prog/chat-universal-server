import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";
import { config } from "./config.js";
import { setIo } from "./lib/io.js";
import { setupSocket } from "./socket.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import contactRoutes from "./routes/contacts.js";
import conversationRoutes from "./routes/conversations.js";
import uploadRoutes from "./routes/uploads.js";
import webhookRoutes from "./routes/webhooks.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: config.corsOrigin, credentials: true },
});
setIo(io);
setupSocket(io);

app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// Rate limits: a general API ceiling plus stricter buckets for auth and webhooks.
app.use(
  "/api",
  rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false })
);
app.use(
  "/api/auth",
  rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false })
);
app.use(
  "/api/webhooks",
  rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false })
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/webhooks", webhookRoutes);

app.use("/uploads", express.static(path.resolve(config.uploadDir)));

// In production the built React app is served from ./public with an SPA fallback.
const publicDir = path.resolve("public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^\/(?!api|uploads|socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  }
);

server.listen(config.port, () => {
  console.log(`chat-universal server listening on :${config.port}`);
});

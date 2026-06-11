// ─────────────────────────────────────────────
// NetSpeed.me – Speedtest backend API (Express)
//
// Endpoints (all CORS-enabled):
//   GET  /ping                 → JSON latency probe
//   GET  /download?size=100MB  → streams N incompressible bytes
//        (also accepts ?bytes=N for raw byte counts)
//   POST /upload               → accepts a binary body, returns JSON metrics
//   GET  /                     → API info / health check
//
// Designed for Hostinger Node.js hosting: binds to process.env.PORT
// and starts via `npm start` (node server.js).
// ─────────────────────────────────────────────

const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 4000;

const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB cap
const DEFAULT_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MB cap

// One random 64KB block, reused for download payloads — incompressible,
// so transparent compression can't inflate the measured speed.
const BLOCK = crypto.randomBytes(65536);

// ── CORS + cache headers on every response ──
// Timing-Allow-Origin lets browsers expose Resource Timing details
// (TCP connect, request/response phases) to the frontend, which needs
// them to measure network latency without proxy/server overhead.
app.use((req, res, next) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Timing-Allow-Origin": "*",
  });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Parse "100MB", "500kb", "1GB", or a plain number of bytes.
function parseSize(value) {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)\s*(KB|MB|GB|B)?$/i.exec(String(value).trim());
  if (!match) return null;
  const units = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
  const unit = (match[2] || "B").toUpperCase();
  return Math.floor(Number(match[1]) * units[unit]);
}

// ── GET / — health check / API info ──
app.get("/", (req, res) => {
  res.json({
    name: "netspeed-backend",
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    endpoints: {
      ping: "GET /ping",
      download: "GET /download?size=100MB (or ?bytes=N, max 1GB)",
      upload: "POST /upload (binary body, max 512MB)",
    },
  });
});

// ── GET /ping — latency probe ──
// Connection: close forces each ping to open a fresh TCP connection, so
// the browser's Resource Timing exposes the TCP handshake — one pure
// network round trip, unaffected by per-request proxy/app processing.
// Server-Timing reports app processing so clients can subtract it when
// they fall back to request/response timing.
app.get("/ping", (req, res) => {
  const t0 = process.hrtime.bigint();
  res.set("Connection", "close");
  const appMs = Number(process.hrtime.bigint() - t0) / 1e6;
  res.set("Server-Timing", `app;dur=${appMs.toFixed(2)}`);
  res.json({
    pong: true,
    serverTimestamp: Date.now(),
  });
});

// ── GET /download?size=100MB — incompressible byte stream ──
app.get("/download", (req, res) => {
  let requested = DEFAULT_DOWNLOAD_BYTES;
  if (req.query.size !== undefined || req.query.bytes !== undefined) {
    requested = parseSize(req.query.size) ?? parseSize(req.query.bytes);
    if (requested === null || requested <= 0) {
      return res.status(400).json({ error: "Invalid size parameter" });
    }
  }
  const bytes = Math.min(requested, MAX_DOWNLOAD_BYTES);

  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Length": bytes,
    "X-Payload-Bytes": bytes,
    "X-Server-Timestamp": Date.now(),
  });

  let sent = 0;
  const write = () => {
    while (sent < bytes) {
      const chunk =
        sent + BLOCK.length <= bytes ? BLOCK : BLOCK.subarray(0, bytes - sent);
      sent += chunk.length;
      if (!res.write(chunk)) {
        res.once("drain", write); // respect backpressure
        return;
      }
    }
    res.end();
  };
  write();
});

// ── POST /upload — receive and discard a binary body, report metrics ──
app.post("/upload", (req, res) => {
  const startedAt = process.hrtime.bigint();
  let received = 0;
  let aborted = false;

  req.on("data", (chunk) => {
    received += chunk.length;
    if (received > MAX_UPLOAD_BYTES && !aborted) {
      aborted = true;
      res.status(413).json({ error: "Upload exceeds 512MB limit", receivedBytes: received });
      req.destroy();
    }
  });

  req.on("end", () => {
    if (aborted) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const seconds = durationMs / 1000;
    res.json({
      receivedBytes: received,
      durationMs: Math.round(durationMs * 100) / 100,
      // Server-side throughput estimate; the client's own timing is authoritative.
      mbps: seconds > 0 ? Math.round(((received * 8) / seconds / 1e6) * 100) / 100 : null,
      serverTimestamp: Date.now(),
    });
  });

  req.on("error", () => {
    if (!res.headersSent) res.status(400).json({ error: "Upload stream error" });
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

const server = app.listen(PORT, () => {
  console.log(`NetSpeed backend listening on port ${PORT}`);
});

// Disable Nagle's algorithm: small responses (ping) go out immediately
// instead of waiting to coalesce with further writes.
server.on("connection", (socket) => socket.setNoDelay(true));

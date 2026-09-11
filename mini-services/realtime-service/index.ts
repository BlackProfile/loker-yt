// Realtime service — socket.io broadcast ringan untuk sinkronisasi publik <-> admin.
// Port tetap 3003 (diakses frontend via Caddy: io("/?XTransformPort=3003", { path: "/rt" })).
// Namespace socket selalu "/" dan query XTransformPort=3003 diteruskan Caddy ke port ini.
// Path transport "/rt" agar request /health & /emit tidak tertelan engine.io.
// Prinsip: event HANYA sinyal invalidate (tanpa payload data) sehingga aman di-broadcast
// ke semua client — client yang berhak (admin) akan memuat ulang lewat API terautentikasi.

import { createServer } from "node:http";
import { Server } from "socket.io";

const PORT = 3003;
const SECRET = process.env.REALTIME_SECRET ?? "lumina-realtime-secret";

const httpServer = createServer();

const io = new Server(httpServer, {
  // Path transport khusus agar /health & /emit tetap bisa dilayani httpServer.
  // Jangan gunakan path "/socket.io" default — bentrok dengan handler bawaan.
  path: "/rt",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  console.log(`[realtime] client connected: ${socket.id} (total=${io.engine.clientsCount})`);

  socket.emit("hello", { ok: true, t: Date.now() });

  socket.on("disconnect", (reason) => {
    console.log(
      `[realtime] client disconnected: ${socket.id} (${reason}) total=${io.engine.clientsCount}`,
    );
  });
});

// Health check + endpoint emit internal (dipanggil API Next.js via 127.0.0.1).
httpServer.on("request", (req, res) => {
  try {
    // Abaikan permintaan engine.io (path "/rt" dengan query EIO) — ditangani socket.io.
    const url = req.url ?? "";
    if (url.includes("EIO=") || res.headersSent) return;

    if (url.startsWith("/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, clients: io.engine.clientsCount }));
      return;
    }

  if (url.startsWith("/emit") && req.method === "POST") {
    let body = "";
    let overflow = false;
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 4096) {
        overflow = true;
        req.destroy();
      }
    });
    req.on("end", () => {
      if (overflow) return;
      try {
        const parsed = JSON.parse(body) as { secret?: string; events?: unknown };
        if (parsed.secret !== SECRET) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "forbidden" }));
          return;
        }
        const events = Array.isArray(parsed.events)
          ? parsed.events.filter((e): e is string => typeof e === "string" && e.length < 64)
          : [];
        for (const event of events) io.emit(event);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, emitted: events.length }));
      } catch {
        if (!res.headersSent) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "bad request" }));
        }
      }
    });
    return;
  }

  } catch {
    // Jangan pernah biarkan handler mematikan proses (anti-error).
    if (!res.headersSent) {
      try {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "internal" }));
      } catch {
        // abaikan
      }
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`[realtime] listening on :${PORT} (path "/rt", events: positions:changed | applications:changed | site:changed)`);
});

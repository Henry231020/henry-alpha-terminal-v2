
require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      app: "HENRY ALPHA TERMINAL V2",
      mode: "provider-comparison-prototype",
      providers: ["PumpPortal", "Shrine"],
      startedAt
    }));
  }

  const file = path.join(__dirname, "public", "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    return res.end("Dashboard not created yet.");
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  fs.createReadStream(file).pipe(res);
});

const startedAt = new Date().toISOString();

const wss = new WebSocket.Server({ server, path: "/ws" });
const clients = new Set();
const recentEvents = [];
const MAX_EVENTS = 200;

wss.on("connection", (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify({
    type: "status",
    message: "Connected to prototype backend",
    time: new Date().toISOString()
  }));

  socket.on("close", () => clients.delete(socket));
});

function broadcast(event) {
  recentEvents.unshift(event);
  if (recentEvents.length > MAX_EVENTS) recentEvents.pop();

  const message = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

server.listen(PORT, HOST, () => {
  console.log(`HENRY ALPHA TERMINAL V2 listening on ${PORT}`);
});

// Provider connections will be added after their official
// endpoint, authentication and subscription requirements
// have been verified. No trading is performed.

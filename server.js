require("dotenv").config();

const http = require("http");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const PUMP_URL = "wss://pumpportal.fun/api/data";

const startedAt = new Date().toISOString();
const recentEvents = [];
const MAX_EVENTS = 100;
const clients = new Set();

let pumpSocket = null;
let pumpStatus = "connecting";
let reconnectTimer = null;
let reconnectDelay = 2000;
let totalEvents = 0;

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    return res.end(JSON.stringify({
      ok: true,
      app: "HENRY ALPHA TERMINAL V2",
      mode: "provider-comparison-prototype",
      startedAt
    }));
  }

  if (req.url === "/status") {
    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    return res.end(JSON.stringify({
      ok: true,
      pumpPortal: pumpStatus,
      totalEvents,
      recentEvents: recentEvents.length,
      automaticTrading: false
    }));
  }

  if (req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    return res.end(JSON.stringify(recentEvents));
  }

  const file = path.join(
    __dirname,
    "public",
    "index.html"
  );

  if (!fs.existsSync(file)) {
    res.writeHead(503);
    return res.end("Dashboard file not found.");
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });

  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocket.Server({
  server,
  path: "/ws"
});

wss.on("connection", (socket) => {
  clients.add(socket);

  socket.send(JSON.stringify({
    type: "status",
    provider: "PumpPortal",
    status: pumpStatus,
    time: new Date().toISOString()
  }));

  socket.on("close", () => {
    clients.delete(socket);
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function connectPumpPortal() {
  if (pumpSocket) {
    pumpSocket.removeAllListeners();
    pumpSocket.terminate();
  }

  clearTimeout(reconnectTimer);
  pumpStatus = "connecting";
  console.log("Connecting to PumpPortal...");

  const socket = new WebSocket(PUMP_URL);
  pumpSocket = socket;

  socket.on("open", () => {
    pumpStatus = "connected";
    reconnectDelay = 2000;

    console.log("PumpPortal connected");

    socket.send(JSON.stringify({
      method: "subscribeNewToken"
    }));

    socket.send(JSON.stringify({
      method: "subscribeMigration"
    }));

    broadcast({
      type: "status",
      provider: "PumpPortal",
      status: pumpStatus,
      time: new Date().toISOString()
    });
  });

  socket.on("message", (raw) => {
    let payload;

    try {
      payload = JSON.parse(raw.toString());
    } catch {
      console.log("Received a non-JSON provider message");
      return;
    }

    totalEvents++;

    const event = {
      provider: "PumpPortal",
      receivedAt: new Date().toISOString(),
      data: payload
    };

    recentEvents.unshift(event);

    if (recentEvents.length > MAX_EVENTS) {
      recentEvents.pop();
    }

    console.log("PumpPortal event received:", totalEvents);
    broadcast({
      type: "provider-event",
      ...event
    });
  });

  socket.on("error", (error) => {
    console.error("PumpPortal connection error:", error.message);
  });

  socket.on("close", () => {
    if (pumpSocket !== socket) return;

    pumpStatus = "disconnected";

    broadcast({
      type: "status",
      provider: "PumpPortal",
      status: pumpStatus,
      time: new Date().toISOString()
    });

    console.log("PumpPortal disconnected. Reconnecting soon.");

    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connectPumpPortal();
    }, reconnectDelay);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`HENRY ALPHA TERMINAL V2 listening on ${PORT}`);
  connectPumpPortal();
});

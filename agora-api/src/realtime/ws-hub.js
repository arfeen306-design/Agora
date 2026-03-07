const http = require("http");
const { URL } = require("url");
const { WebSocket, WebSocketServer } = require("ws");

const { verifyAccessToken } = require("../utils/jwt");

function extractBearerToken(headerValue) {
  if (!headerValue) return null;
  const parts = headerValue.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

function extractAccessToken(req) {
  const authHeaderToken = extractBearerToken(req.headers.authorization);
  if (authHeaderToken) return authHeaderToken;

  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const queryToken = url.searchParams.get("access_token") || url.searchParams.get("token");
    return queryToken || null;
  } catch (_e) {
    return null;
  }
}

function denyUpgrade(socket, statusCode, message) {
  const statusText = http.STATUS_CODES[statusCode] || "Unauthorized";
  const body = JSON.stringify({
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message,
      details: [],
    },
    meta: {
      request_id: null,
    },
  });

  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Connection: close\r\n" +
      "\r\n" +
      body
  );
  socket.destroy();
}

function initWebSocketServer(server) {
  const wss = new WebSocketServer({ noServer: true });
  const socketsByUserId = new Map();
  const socketMeta = new Map();

  function registerSocket(ws, auth) {
    socketMeta.set(ws, auth);
    if (!socketsByUserId.has(auth.userId)) {
      socketsByUserId.set(auth.userId, new Set());
    }
    socketsByUserId.get(auth.userId).add(ws);
  }

  function unregisterSocket(ws) {
    const auth = socketMeta.get(ws);
    if (!auth) return;

    const userSockets = socketsByUserId.get(auth.userId);
    if (userSockets) {
      userSockets.delete(ws);
      if (userSockets.size === 0) {
        socketsByUserId.delete(auth.userId);
      }
    }

    socketMeta.delete(ws);
  }

  function sendSocketEvent(ws, event, data) {
    if (ws.readyState !== WebSocket.OPEN) return false;

    ws.send(
      JSON.stringify({
        event,
        data,
        timestamp: new Date().toISOString(),
      })
    );
    return true;
  }

  function emitToUser(userId, event, data, options = {}) {
    const sockets = socketsByUserId.get(userId);
    if (!sockets || sockets.size === 0) return 0;

    let delivered = 0;
    for (const ws of sockets) {
      const auth = socketMeta.get(ws);
      if (!auth) continue;
      if (options.schoolId && auth.schoolId !== options.schoolId) continue;
      if (sendSocketEvent(ws, event, data)) {
        delivered += 1;
      }
    }

    return delivered;
  }

  function emitToUsers(userIds, event, data, options = {}) {
    if (!Array.isArray(userIds) || userIds.length === 0) return 0;

    const uniqueUserIds = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0))];
    let delivered = 0;

    for (const userId of uniqueUserIds) {
      delivered += emitToUser(userId, event, data, options);
    }

    return delivered;
  }

  wss.on("connection", (ws) => {
    const auth = socketMeta.get(ws);
    if (!auth) {
      ws.close(1008, "Unauthorized");
      return;
    }

    sendSocketEvent(ws, "ws.connected", {
      user_id: auth.userId,
      school_id: auth.schoolId,
      roles: auth.roles,
    });

    ws.on("message", (raw) => {
      try {
        const parsed = JSON.parse(String(raw));
        if (parsed && parsed.type === "ping") {
          sendSocketEvent(ws, "ws.pong", { ok: true });
        }
      } catch (_e) {
        sendSocketEvent(ws, "ws.error", { message: "Invalid JSON payload" });
      }
    });

    ws.on("close", () => {
      unregisterSocket(ws);
    });

    ws.on("error", () => {
      unregisterSocket(ws);
    });
  });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) {
      socket.destroy();
      return;
    }

    const token = extractAccessToken(req);
    if (!token) {
      denyUpgrade(socket, 401, "Missing access token for websocket");
      return;
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (_e) {
      denyUpgrade(socket, 401, "Invalid or expired websocket token");
      return;
    }

    if (payload.token_type !== "access" || !payload.sub || !payload.school_id) {
      denyUpgrade(socket, 401, "Invalid websocket access token type");
      return;
    }

    const auth = {
      userId: payload.sub,
      schoolId: payload.school_id,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
    };

    wss.handleUpgrade(req, socket, head, (ws) => {
      registerSocket(ws, auth);
      wss.emit("connection", ws, req);
    });
  });

  return {
    emitToUser,
    emitToUsers,
  };
}

module.exports = {
  initWebSocketServer,
};

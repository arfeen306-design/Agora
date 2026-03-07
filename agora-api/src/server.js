const http = require("http");

const app = require("./app");
const config = require("./config");
const { setRealtimeHub } = require("./realtime/hub");
const { initWebSocketServer } = require("./realtime/ws-hub");

const server = http.createServer(app);
const realtimeHub = initWebSocketServer(server);
setRealtimeHub(realtimeHub);

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Agora API listening on http://localhost:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`Agora realtime listening on ws://localhost:${config.port}/ws`);
});

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
const candidate = Object.entries(lock.packages ?? {}).find(([path, metadata]) =>
  (path === "node_modules/ws" || path.endsWith("/node_modules/ws"))
  && metadata.version === "8.21.1"
  && existsSync(resolve(root, path)),
);

if (!candidate) throw new Error("no installed ws 8.21.x canary target found");

const [packagePath, metadata] = candidate;
const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require(resolve(root, packagePath));
const rssBefore = process.memoryUsage().rss;
const errors = [];
const onUnhandledRejection = (error) => errors.push(error);
process.on("unhandledRejection", onUnhandledRejection);

const server = new WebSocketServer({ port: 0 });
await new Promise((accept, reject) => {
  server.once("listening", accept);
  server.once("error", reject);
});

const address = server.address();
if (!address || typeof address === "string") throw new Error("canary server did not bind to TCP");

let connections = 0;
server.on("connection", (socket) => {
  connections += 1;
  socket.on("message", (message) => socket.send(`ack:${message}`));
});

async function roundTrip(sequence) {
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  await new Promise((accept, reject) => {
    socket.once("open", accept);
    socket.once("error", reject);
  });
  socket.send(`message-${sequence}`);
  const reply = await new Promise((accept, reject) => {
    socket.once("message", (message) => accept(String(message)));
    socket.once("error", reject);
  });
  socket.close(1000, "canary complete");
  await new Promise((accept) => socket.once("close", accept));
  if (reply !== `ack:message-${sequence}`) throw new Error(`unexpected reply: ${reply}`);
}

for (let sequence = 1; sequence <= 25; sequence += 1) {
  await roundTrip(sequence);
}

await new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
process.off("unhandledRejection", onUnhandledRejection);

const rssDeltaBytes = process.memoryUsage().rss - rssBefore;
if (connections !== 25) throw new Error(`expected 25 connections, received ${connections}`);
if (errors.length > 0) throw new AggregateError(errors, "WebSocket canary had unhandled rejections");
if (rssDeltaBytes > 128 * 1024 * 1024) {
  throw new Error(`WebSocket canary RSS grew by ${rssDeltaBytes} bytes`);
}

console.log(JSON.stringify({
  ws: metadata.version,
  packagePath,
  connections,
  reconnects: connections - 1,
  unhandledRejections: errors.length,
  rssDeltaBytes,
}));

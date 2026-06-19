const { spawn } = require("child_process");
const { WebSocket } = require("ws");

const PORT = 3139;
const URL = `ws://127.0.0.1:${PORT}/ws`;
const TILE = 32;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), LEGACY_TEST_MODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer();
    const player = await connectPlayer("WarpRestore");
    await enterCombat(player);
    const depth1 = await waitForState(player, (state) => state.snapshot.id === "combat" && state.snapshot.portals.length > 1);
    const nextPortal = depth1.snapshot.portals.find((portal) => portal.kind === "next");
    assert(nextPortal, "depth 1 should expose a next portal");

    player.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: nextPortal.x, y: nextPortal.y } }));
    const depth2 = await waitForState(player, (state) => state.snapshot.id === "combat2");
    const backPortal = depth2.snapshot.portals.find((portal) => portal.kind === "previous");
    assert(backPortal, "depth 2 should expose a previous portal");

    player.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: backPortal.x, y: backPortal.y } }));
    const returned = await waitForState(player, (state) => state.snapshot.id === "combat");
    const self = returned.snapshot.players.find((candidate) => candidate.id === player.id);
    const currentNextPortal = returned.snapshot.portals.find((portal) => portal.kind === "next");
    assert(distance(self, currentNextPortal) <= TILE * 2.2, "returning from depth 2 should place player next to depth 1 exit portal");
    assert(distance(self, { x: 40 * TILE, y: 70 * TILE }) > TILE * 4, "returning from depth 2 should not place player at depth 1 entrance");

    player.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: TILE, y: TILE } }));
    await waitForState(player, (state) => {
      const current = state.snapshot.players.find((candidate) => candidate.id === player.id);
      return current && current.x <= TILE * 1.5 && current.y <= TILE * 1.5;
    });
    player.ws.close();
    await delay(120);

    const restored = await connectPlayer("WarpRestore", false);
    const restoredState = await waitForState(restored, (state) => state.snapshot.id === "combat");
    const restoredSelf = restoredState.snapshot.players.find((candidate) => candidate.id === restored.id);
    const previousPortal = restoredState.snapshot.portals.find((portal) => portal.kind === "previous");
    assert(distance(restoredSelf, previousPortal) <= TILE * 2.2, "invalid restored position should move next to the warp");
    restored.ws.close();

    console.log("Warp restore flow test passed.");
  } finally {
    server.kill();
    if (process.exitCode && stderr) console.error(stderr);
  }
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      const ws = new WebSocket(URL);
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      ws.close();
      return;
    } catch {
      await delay(80);
    }
  }
  throw new Error("Timed out waiting for test server");
}

async function connectPlayer(name, waitForHaven = true) {
  const ws = new WebSocket(URL);
  const messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ t: "hello", accountId: name, name }));
  const client = { ws, messages, cursor: 0, id: null };
  const welcome = await waitForMessage(client, (message) => message.t === "welcome");
  client.id = welcome.id;
  if (waitForHaven) await waitForState(client, (state) => state.snapshot.id === "haven");
  return client;
}

async function enterCombat(client) {
  client.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: 40 * TILE, y: 36 * TILE } }));
  await waitForState(client, (state) => state.snapshot.id === "combat");
}

async function waitForState(client, predicate, timeout = 5000) {
  return waitForMessage(client, (message) => message.t === "state" && predicate(message), timeout);
}

async function waitForMessage(client, predicate, timeout = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    while (client.cursor < client.messages.length) {
      const message = client.messages[client.cursor];
      client.cursor += 1;
      if (predicate(message)) return message;
    }
    await delay(20);
  }
  throw new Error("Timed out waiting for WebSocket message");
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

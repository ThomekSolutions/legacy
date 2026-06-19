const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { WebSocket } = require("ws");

const PORT = 3137;
const URL = `ws://127.0.0.1:${PORT}/ws`;
const TILE = 32;
const DATA_DIR = path.join(__dirname, "..", "artifacts", "test-inventory-data");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), LEGACY_TEST_MODE: "1", DATA_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer();
    const alpha = await connectPlayer("Alpha", "Test");
    const beta = await connectPlayer("Beta", "Test");
    await enterCombat(alpha);
    await enterCombat(beta);

    beta.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: 50 * TILE, y: 50 * TILE } }));
    await waitForState(beta, (state) => state.snapshot.players.some((player) => player.id === beta.id && player.x > 49 * TILE));

    alpha.ws.send(JSON.stringify({ t: "testSpawnDamageLoot", damageBy: { [alpha.id]: 4, [beta.id]: 12 } }));
    await waitForState(alpha, (state) => state.snapshot.loot.length === 0);
    const betaLootState = await waitForState(beta, (state) => state.snapshot.loot.length === 1);
    const loot = betaLootState.snapshot.loot[0];
    assert(loot.item && loot.item.uid, "private loot should expose an item to its owner");

    beta.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: loot.x, y: loot.y } }));
    const betaCollected = await waitForState(beta, (state) => state.snapshot.inventory.length === 1);
    const itemId = betaCollected.snapshot.inventory[0].uid;

    beta.ws.send(JSON.stringify({ t: "equipItem", itemId }));
    const betaEquipped = await waitForState(beta, (state) => Object.values(state.snapshot.equipment).some(Boolean));
    assert(betaEquipped.snapshot.inventory.length === 0, "equipping should remove the item from inventory");

    for (let i = 0; i < 11; i += 1) alpha.ws.send(JSON.stringify({ t: "testGiveItem" }));
    await waitForState(alpha, (state) => state.snapshot.inventory.length === 10);
    alpha.ws.send(JSON.stringify({ t: "testSpawnPrivateLoot" }));
    const fullBagState = await waitForState(alpha, (state) => state.snapshot.inventory.length === 10 && state.snapshot.loot.length >= 1);
    assert(fullBagState.snapshot.inventorySize === 10, "inventory size should be advertised as 10");

    alpha.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: 52 * TILE, y: 52 * TILE } }));
    await waitForState(alpha, (state) => state.snapshot.players.some((player) => player.id === alpha.id && player.x > 51 * TILE));
    const destroyId = fullBagState.snapshot.inventory[0].uid;
    alpha.ws.send(JSON.stringify({ t: "destroyItem", itemId: destroyId }));
    await waitForState(alpha, (state) => state.snapshot.inventory.length === 9);

    alpha.ws.send(JSON.stringify({ t: "testKillPlayer" }));
    await waitForMessage(alpha, (message) => message.t === "death");
    alpha.ws.send(JSON.stringify({ t: "respawn" }));
    await waitForState(alpha, (state) => state.snapshot.inventory.length === 0 && Object.values(state.snapshot.equipment).every((item) => item === null));

    alpha.ws.close();
    beta.ws.close();
    console.log("Inventory flow test passed.");
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

async function connectPlayer(name, house) {
  const ws = new WebSocket(URL);
  const messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ t: "hello", accountId: `${name}-${Date.now()}`, name, house }));
  const client = { ws, messages, cursor: 0, id: null };
  const welcome = await waitForMessage(client, (message) => message.t === "welcome");
  client.id = welcome.id;
  await waitForState(client, (state) => state.snapshot.id === "haven");
  return client;
}

async function enterCombat(client) {
  client.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: 40 * TILE, y: 42 * TILE } }));
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

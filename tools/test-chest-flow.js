const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { WebSocket } = require("ws");

const PORT = 3138;
const URL = `ws://127.0.0.1:${PORT}/ws`;
const TILE = 32;
const DATA_DIR = path.join(__dirname, "..", "artifacts", "test-chest-data");

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
    const player = await connectPlayer("Chest", "Test");
    await moveToChest(player);

    player.ws.send(JSON.stringify({ t: "testGiveItem", rarity: "rare" }));
    const withItem = await waitForState(player, (state) => state.snapshot.inventory.length === 1);
    const storedItemId = withItem.snapshot.inventory[0].uid;
    player.ws.send(JSON.stringify({ t: "chestDeposit", itemId: storedItemId }));
    await waitForState(player, (state) => state.snapshot.inventory.length === 0 && state.snapshot.chestItems.some((item) => item.uid === storedItemId));

    player.ws.send(JSON.stringify({ t: "testKillPlayer" }));
    await waitForMessage(player, (message) => message.t === "death");
    player.ws.send(JSON.stringify({ t: "respawn" }));
    await waitForState(player, (state) => state.snapshot.inventory.length === 0 && state.snapshot.chestItems.some((item) => item.uid === storedItemId));

    await moveToChest(player);
    player.ws.send(JSON.stringify({ t: "chestWithdraw", itemId: storedItemId }));
    await waitForState(player, (state) => state.snapshot.inventory.some((item) => item.uid === storedItemId));

    player.ws.send(JSON.stringify({ t: "equipItem", itemId: storedItemId }));
    const equippedState = await waitForState(player, (state) => Object.values(state.snapshot.equipment).some((item) => item?.uid === storedItemId));
    const beforeHp = equippedState.snapshot.players.find((entry) => entry.id === player.id).maxHp;
    player.ws.send(JSON.stringify({ t: "chestDeposit", itemId: storedItemId }));
    const unequippedState = await waitForState(player, (state) => Object.values(state.snapshot.equipment).every((item) => item === null) && state.snapshot.chestItems.some((item) => item.uid === storedItemId));
    const afterHp = unequippedState.snapshot.players.find((entry) => entry.id === player.id).maxHp;
    assert(afterHp <= beforeHp, "depositing equipped gear should recalculate stats");

    player.ws.send(JSON.stringify({ t: "testGiveCurrency", kind: "fragment", id: "magic", amount: 2 }));
    player.ws.send(JSON.stringify({ t: "testGiveCurrency", kind: "shard", id: "quality", amount: 1 }));
    const withResources = await waitForState(player, (state) => resourceAmount(state, "fragment", "magic") === 2 && resourceAmount(state, "shard", "quality") === 1);
    player.ws.send(JSON.stringify({ t: "chestDeposit", itemId: resourceItem(withResources, "fragment", "magic").uid }));
    await waitForState(player, (state) => resourceAmount(state, "fragment", "magic") === 0 && chestResourceAmount(state, "fragment", "magic") === 2);
    const withShard = await waitForState(player, (state) => resourceAmount(state, "shard", "quality") === 1);
    player.ws.send(JSON.stringify({ t: "chestDeposit", itemId: resourceItem(withShard, "shard", "quality").uid }));
    await waitForState(player, (state) => resourceAmount(state, "shard", "quality") === 0 && chestResourceAmount(state, "shard", "quality") === 1);

    player.ws.send(JSON.stringify({ t: "testKillPlayer" }));
    await waitForMessage(player, (message) => message.t === "death");
    player.ws.send(JSON.stringify({ t: "respawn" }));
    await waitForState(player, (state) => (state.snapshot.resources || []).length === 0 && chestResourceAmount(state, "fragment", "magic") === 2 && chestResourceAmount(state, "shard", "quality") === 1);

    await moveToChest(player);
    const chestFragment = await waitForState(player, (state) => chestResourceAmount(state, "fragment", "magic") === 2);
    player.ws.send(JSON.stringify({ t: "chestWithdraw", itemId: chestResourceItem(chestFragment, "fragment", "magic").uid }));
    await waitForState(player, (state) => resourceAmount(state, "fragment", "magic") === 2 && chestResourceAmount(state, "fragment", "magic") === 0);

    player.ws.send(JSON.stringify({ t: "testGiveGold", amount: 123 }));
    await waitForState(player, (state) => selfGold(state, player.id) >= 123);
    player.ws.send(JSON.stringify({ t: "chestDepositGold", amount: 40 }));
    await waitForState(player, (state) => selfGold(state, player.id) === 83 && state.snapshot.chestGold === 40);
    player.ws.send(JSON.stringify({ t: "chestWithdrawGold", amount: 15 }));
    await waitForState(player, (state) => selfGold(state, player.id) === 98 && state.snapshot.chestGold === 25);
    player.ws.send(JSON.stringify({ t: "chestDepositGold", amount: 9999 }));
    await waitForState(player, (state) => selfGold(state, player.id) === 0 && state.snapshot.chestGold === 123);
    player.ws.send(JSON.stringify({ t: "testKillPlayer" }));
    await waitForMessage(player, (message) => message.t === "death");
    player.ws.send(JSON.stringify({ t: "respawn" }));
    await waitForState(player, (state) => selfGold(state, player.id) === 0 && state.snapshot.chestGold === 123);
    await moveToChest(player);
    player.ws.send(JSON.stringify({ t: "chestWithdrawGold", amount: 9999 }));
    await waitForState(player, (state) => selfGold(state, player.id) === 123 && state.snapshot.chestGold === 0);

    const browserPlayer = await connectBrowserPlayer();
    const firstBrowserState = await waitForState(browserPlayer, (state) => state.snapshot.id === "haven");
    const firstAppearance = JSON.stringify(firstBrowserState.snapshot.players.find((entry) => entry.id === browserPlayer.id).appearance);
    browserPlayer.ws.send(JSON.stringify({ t: "testGiveCurrency", kind: "shard", id: "quality", amount: 2 }));
    await waitForState(browserPlayer, (state) => resourceAmount(state, "shard", "quality") === 2);
    browserPlayer.ws.close();
    await delay(120);
    const refreshedBrowserPlayer = await connectBrowserPlayer();
    const refreshedState = await waitForState(refreshedBrowserPlayer, (state) => resourceAmount(state, "shard", "quality") === 2);
    const refreshedAppearance = JSON.stringify(refreshedState.snapshot.players.find((entry) => entry.id === refreshedBrowserPlayer.id).appearance);
    assert(refreshedAppearance === firstAppearance, "test browser player should keep appearance across refresh");
    refreshedBrowserPlayer.ws.close();

    player.ws.close();
    console.log("Chest flow test passed.");
  } finally {
    server.kill();
    if (process.exitCode && stderr) console.error(stderr);
  }
}

async function moveToChest(client) {
  client.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: 52 * TILE, y: 54 * TILE } }));
  await waitForState(client, (state) => state.snapshot.chestNearby);
}

function resourceItem(state, kind, id) {
  return (state.snapshot.resources || []).find((item) => item.resourceKind === kind && item.resourceId === id);
}

function resourceAmount(state, kind, id) {
  return resourceItem(state, kind, id)?.stack || 0;
}

function chestResourceItem(state, kind, id) {
  return (state.snapshot.chestItems || []).find((item) => item.resourceKind === kind && item.resourceId === id);
}

function chestResourceAmount(state, kind, id) {
  return chestResourceItem(state, kind, id)?.stack || 0;
}

function selfGold(state, playerId) {
  return state.snapshot.players.find((entry) => entry.id === playerId)?.gold || 0;
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

async function connectBrowserPlayer() {
  const ws = new WebSocket(URL);
  const messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ t: "hello" }));
  const client = { ws, messages, cursor: 0, id: null };
  const welcome = await waitForMessage(client, (message) => message.t === "welcome");
  client.id = welcome.id;
  await waitForState(client, (state) => state.snapshot.id === "haven");
  return client;
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

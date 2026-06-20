const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { WebSocket } = require("ws");

const PORT = 3138;
const URL = `ws://127.0.0.1:${PORT}/ws`;
const TILE = 32;
const DATA_DIR = path.join(__dirname, "..", "artifacts", "test-forge-data");

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
    const player = await connectPlayer("ForgeTester");
    await enterCombat(player);

    player.ws.send(JSON.stringify({ t: "testGiveItem", rarity: "common", depth: 10 }));
    player.ws.send(JSON.stringify({ t: "testGiveCurrency", kind: "shard", id: "quality", amount: 1 }));
    const awaySetup = await waitForState(player, (state) => (
      state.snapshot.inventory.some((item) => item.rarity === "common")
      && resourceAmount(state, "shard", "quality") === 1
      && !state.snapshot.forgeNearby
    ));
    const commonId = awaySetup.snapshot.inventory.find((item) => item.rarity === "common").uid;
    const qualityId = resourceItem(awaySetup, "shard", "quality").uid;

    player.ws.send(JSON.stringify({ t: "applyShard", shardItemId: qualityId, targetItemId: commonId }));
    const looseResult = await waitForMessage(player, (message) => message.t === "forgeResult" && !message.ok);
    assert(/forge/i.test(looseResult.message || ""), "loose applyShard should explain the forge requirement");
    await waitForState(player, (state) => resourceAmount(state, "shard", "quality") === 1 && itemById(state, commonId)?.rarity === "common");

    player.ws.send(JSON.stringify({ t: "forgeApplyShard", shardItemId: qualityId, targetItemId: commonId }));
    const farApply = await waitForMessage(player, (message) => message.t === "forgeResult" && !message.ok);
    assert(/forge/i.test(farApply.message || ""), "forgeApplyShard away from forge should explain the forge requirement");
    await waitForState(player, (state) => resourceAmount(state, "shard", "quality") === 1 && itemById(state, commonId)?.rarity === "common");

    player.ws.send(JSON.stringify({ t: "testGiveCurrency", kind: "fragment", id: "magic", amount: 5 }));
    await returnToForge(player);
    const readyToConvert = await waitForState(player, (state) => state.snapshot.forgeNearby && resourceAmount(state, "fragment", "magic") >= 5);
    player.ws.send(JSON.stringify({ t: "forgeConvertFragment", fragmentItemId: resourceItem(readyToConvert, "fragment", "magic").uid }));
    const refineResult = await waitForMessage(player, (message) => message.t === "forgeResult" && message.ok && /Converted 5/.test(message.message || ""));
    assert(/Transmutation Shard/.test(refineResult.message || ""), "refine success should name the created shard");
    await waitForState(player, (state) => resourceAmount(state, "shard", "transmutation") === 1 && resourceAmount(state, "fragment", "magic") === 0);

    player.ws.send(JSON.stringify({ t: "testGiveCurrency", kind: "shard", id: "legend", amount: 1 }));
    const invalidSetup = await waitForState(player, (state) => resourceAmount(state, "shard", "legend") === 1 && resourceAmount(state, "shard", "transmutation") === 1);
    player.ws.send(JSON.stringify({ t: "forgeApplyShard", shardItemId: resourceItem(invalidSetup, "shard", "legend").uid, targetItemId: commonId }));
    await waitForMessage(player, (message) => message.t === "forgeResult" && !message.ok);
    await waitForState(player, (state) => resourceAmount(state, "shard", "legend") === 1 && itemById(state, commonId)?.rarity === "common");

    const transmutation = resourceItem(await waitForState(player, (state) => resourceAmount(state, "shard", "transmutation") === 1), "shard", "transmutation");
    player.ws.send(JSON.stringify({ t: "forgeApplyShard", shardItemId: transmutation.uid, targetItemId: commonId }));
    await waitForMessage(player, (message) => message.t === "forgeResult" && message.ok && /Transmutation Shard applied/i.test(message.message || ""));
    await waitForState(player, (state) => {
      const item = itemById(state, commonId);
      return item?.rarity === "magic" && (item.affixes || []).length >= 1 && resourceAmount(state, "shard", "transmutation") === 0;
    });

    player.ws.send(JSON.stringify({ t: "equipItem", itemId: commonId }));
    const equipped = await waitForState(player, (state) => Object.values(state.snapshot.equipment || {}).some((item) => item?.uid === commonId));
    player.ws.send(JSON.stringify({ t: "forgeApplyShard", shardItemId: qualityId, targetItemId: commonId }));
    const equippedResult = await waitForMessage(player, (message) => message.t === "forgeResult" && !message.ok);
    assert(/inventory/i.test(equippedResult.message || ""), "equipped item refusal should ask for inventory first");
    await waitForState(player, (state) => resourceAmount(state, "shard", "quality") === resourceAmount(equipped, "shard", "quality"));

    player.ws.close();
    console.log("Forge flow test passed.");
  } finally {
    server.kill();
    if (process.exitCode && stderr) console.error(stderr);
  }
}

function itemById(state, itemId) {
  return (state.snapshot.inventory || []).find((item) => item.uid === itemId)
    || Object.values(state.snapshot.equipment || {}).find((item) => item?.uid === itemId)
    || null;
}

function resourceItem(state, kind, id) {
  return (state.snapshot.resources || []).find((item) => item.resourceKind === kind && item.resourceId === id);
}

function resourceAmount(state, kind, id) {
  return resourceItem(state, kind, id)?.stack || 0;
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

async function connectPlayer(name) {
  const ws = new WebSocket(URL);
  const messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ t: "hello", accountId: `${name}-${Date.now()}`, name }));
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

async function returnToForge(client) {
  client.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: 40 * TILE, y: 72 * TILE } }));
  await waitForState(client, (state) => state.snapshot.id === "haven");
  client.ws.send(JSON.stringify({ t: "input", dx: 0, dy: 0, attack: false, angle: 0, testWarp: { x: 28 * TILE, y: 42 * TILE } }));
  await waitForState(client, (state) => state.snapshot.forgeNearby);
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

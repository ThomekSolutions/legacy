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

    player.ws.send(JSON.stringify({ t: "testSpawnCurrencyLoot", kind: "fragment", id: "magic", amount: 1 }));
    await waitForState(player, (state) => resourceAmount(state, "fragment", "magic") >= 1 && state.snapshot.inventory.length === 0);

    player.ws.send(JSON.stringify({ t: "testGiveItem", rarity: "magic", depth: 12 }));
    const withItem = await waitForState(player, (state) => state.snapshot.inventory.length === 1);
    const destroyId = withItem.snapshot.inventory[0].uid;
    player.ws.send(JSON.stringify({ t: "destroyItem", itemId: destroyId }));
    await waitForState(player, (state) => state.snapshot.inventory.length === 0 && resourceAmount(state, "fragment", "magic") >= 2);

    player.ws.send(JSON.stringify({ t: "testGiveCurrency", kind: "fragment", id: "magic", amount: 3 }));
    player.ws.send(JSON.stringify({ t: "forgeConvertFragment", fragmentItemId: resourceItem(await waitForState(player, (state) => resourceAmount(state, "fragment", "magic") >= 5), "fragment", "magic").uid }));
    await waitForState(player, (state) => resourceAmount(state, "shard", "transmutation") === 0 && resourceAmount(state, "fragment", "magic") >= 5);

    await returnToForge(player);
    const readyToConvert = await waitForState(player, (state) => resourceAmount(state, "fragment", "magic") >= 5);
    player.ws.send(JSON.stringify({ t: "forgeConvertFragment", fragmentItemId: resourceItem(readyToConvert, "fragment", "magic").uid }));
    await waitForState(player, (state) => resourceAmount(state, "shard", "transmutation") >= 1 && resourceAmount(state, "fragment", "magic") === 0);

    player.ws.send(JSON.stringify({ t: "testGiveItem", rarity: "common", depth: 10 }));
    const commonState = await waitForState(player, (state) => state.snapshot.inventory.some((item) => item.rarity === "common"));
    const common = commonState.snapshot.inventory.find((item) => item.rarity === "common");
    const transmutation = resourceItem(commonState, "shard", "transmutation");
    player.ws.send(JSON.stringify({ t: "forgeApplyShard", shardItemId: transmutation.uid, targetItemId: common.uid }));
    await waitForState(player, (state) => state.snapshot.inventory.some((item) => item.uid === common.uid && item.rarity === "magic" && item.affixes.length >= 1));

    player.ws.send(JSON.stringify({ t: "testGiveCurrency", kind: "shard", id: "quality", amount: 1 }));
    const magicState = await waitForState(player, (state) => state.snapshot.inventory.some((item) => item.uid === common.uid && item.rarity === "magic") && resourceAmount(state, "shard", "quality") >= 1);
    const quality = resourceItem(magicState, "shard", "quality");
    player.ws.send(JSON.stringify({ t: "testGiveCurrency", kind: "shard", id: "legend", amount: 1 }));
    const invalidState = await waitForState(player, (state) => resourceAmount(state, "shard", "legend") >= 1);
    const legendBefore = resourceAmount(invalidState, "shard", "legend");
    player.ws.send(JSON.stringify({ t: "forgeApplyShard", shardItemId: resourceItem(invalidState, "shard", "legend").uid, targetItemId: common.uid }));
    const invalidAfter = await waitForState(player, (state) => resourceAmount(state, "shard", "legend") >= 0);
    assert(resourceAmount(invalidAfter, "shard", "legend") === legendBefore, "incompatible shard should not be consumed");

    player.ws.send(JSON.stringify({ t: "equipItem", itemId: common.uid }));
    const equipped = await waitForState(player, (state) => Object.values(state.snapshot.equipment).some((item) => item?.uid === common.uid));
    const beforeHp = equipped.snapshot.players.find((entry) => entry.id === player.id).maxHp;
    player.ws.send(JSON.stringify({ t: "forgeApplyShard", shardItemId: quality.uid, targetItemId: common.uid }));
    const afterQuality = await waitForState(player, (state) => Object.values(state.snapshot.equipment).some((item) => item?.uid === common.uid && item.quality === 1));
    const afterHp = afterQuality.snapshot.players.find((entry) => entry.id === player.id).maxHp;
    assert(afterHp >= beforeHp, "crafting equipped item should keep stats recalculated");
    assert(magicState.snapshot.forgeNearby, "player should be at the forge for craft checks");

    player.ws.send(JSON.stringify({ t: "testGiveCurrency", kind: "fragment", id: "rare", amount: 2 }));
    await waitForState(player, (state) => resourceAmount(state, "fragment", "rare") === 2);
    player.ws.send(JSON.stringify({ t: "testKillPlayer" }));
    await waitForMessage(player, (message) => message.t === "death");
    player.ws.send(JSON.stringify({ t: "respawn" }));
    await waitForState(player, (state) => (state.snapshot.resources || []).length === 0);

    player.ws.close();
    console.log("Forge flow test passed.");
  } finally {
    server.kill();
    if (process.exitCode && stderr) console.error(stderr);
  }
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

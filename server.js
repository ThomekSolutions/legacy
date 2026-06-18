const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocket, WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const SAVE_FILE = path.join(DATA_DIR, "legacy-state.json");
const CHARACTER_CATALOG_FILE = path.join(ROOT, "assets", "generated-characters", "catalog.json");
const TILE = 32;
const WORLD_W = 80;
const WORLD_H = 80;
const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const MAX_DEPTH = 100;
const COMBAT_WORLD_PREFIX = "combat";
const BASE_ATTACK = {
  shape: "rectangle",
  range: 39,
  halfWidth: 18,
};
const BIOMES = [
  { name: "Ruined Outskirts", floor: "ruin", accent: "grave", hazard: "water", wall: "wall" },
  { name: "Marsh Causeway", floor: "marsh", accent: "ruin", hazard: "water", wall: "wall" },
  { name: "Grave Barrens", floor: "grave", accent: "tomb", hazard: "marsh", wall: "wall" },
  { name: "Wildwood Hollow", floor: "grass", accent: "forest", hazard: "marsh", wall: "forest" },
  { name: "Ashen Keep", floor: "ruin", accent: "rubble", hazard: "grave", wall: "wall" },
  { name: "Cinder Vault", floor: "rubble", accent: "ruin", hazard: "water", wall: "wall" },
];
const MONSTER_NAMES = {
  ruinCrawler: ["Ruin Crawler", "Stone Skitter", "Rubble Gnawer"],
  marshMaw: ["Marsh Maw", "Bog Snapper", "Mire Gulper"],
  graveWraith: ["Grave Wraith", "Pale Mourner", "Tomb Shade"],
  cinderBrute: ["Cinder Brute", "Ash Mauler", "Coalbound"],
};
const MONSTER_HITBOXES = {
  ruinCrawler: { radius: 10.5 },
  marshMaw: { radius: 11.9 },
  graveWraith: { radius: 11.2 },
  cinderBrute: { radius: 15.4 },
  orc: { radius: 12.6 },
};
const PLAYER_HITBOX_RADIUS = 6.5;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const persisted = loadPersisted();
const characterCatalog = loadCharacterCatalog();
const rng = mulberry32(921337);
let instanceSerial = 0;
const worlds = {
  haven: {
    id: "haven",
    name: "Haven",
    tiles: createWorld("haven"),
    enemies: [],
    loot: [],
    combatTexts: [],
    portals: [{ x: 40 * TILE, y: 36 * TILE, target: "combat", label: "Depth 1", spawnX: 40 * TILE, spawnY: 70 * TILE }],
  },
};
worlds.haven.portal = worlds.haven.portals[0];
const activeCombatWorlds = new Map();

const clients = new Map();
const server = http.createServer((req, res) => {
  if (req.url === "/api/legends") {
    sendJson(res, publicLegends());
    return;
  }

  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const safePath = path.normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  let player = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.t === "hello") {
      player = createPlayer(ws, msg);
      clients.set(player.id, player);
      ws.send(JSON.stringify({ t: "welcome", id: player.id, account: player.accountId, meta: player.meta }));
      return;
    }

    if (!player) return;
    if (msg.t === "input") {
      player.input.dx = clamp(Number(msg.dx) || 0, -1, 1);
      player.input.dy = clamp(Number(msg.dy) || 0, -1, 1);
      player.input.attack = !!msg.attack;
      player.input.angle = Number.isFinite(Number(msg.angle)) ? Number(msg.angle) : player.input.angle;
      if (process.env.LEGACY_TEST_MODE === "1" && msg.testWarp) {
        player.x = clamp(Number(msg.testWarp.x) || player.x, TILE, WORLD_W * TILE - TILE);
        player.y = clamp(Number(msg.testWarp.y) || player.y, TILE, WORLD_H * TILE - TILE);
        player.portalCd = 0;
      }
      return;
    }

    if (msg.t === "newHeir") {
      reviveAsHeir(player, msg.name, msg.house, msg.appearance);
    }
  });

  ws.on("close", () => {
    if (player) {
      const oldWorld = player.world;
      clients.delete(player.id);
      cleanupEmptyCombatWorld(oldWorld);
    }
  });
});

setInterval(tick, 1000 / TICK_RATE);
setInterval(savePersisted, 5000);

server.listen(PORT, () => {
  console.log(`Legacy V1 running on http://localhost:${PORT}`);
});

function createPlayer(ws, msg) {
  const accountId = cleanId(msg.accountId) || cryptoId();
  const meta = getMeta(accountId, msg.house);
  const char = makeCharacter(msg.name, meta.dynasty, meta, msg.appearance);
  return {
    ws,
    id: cryptoId(),
    accountId,
    meta,
    input: { dx: 0, dy: 0, attack: false, angle: 0 },
    attackCd: 0,
    portalCd: 1,
    sentWorld: null,
    dead: false,
    ...char,
  };
}

function makeCharacter(name, house, meta, appearance) {
  meta.generation += 1;
  return {
    name: cleanName(name, "Kael"),
    house: cleanName(house || meta.dynasty, "Valen"),
    world: "haven",
    x: 40 * TILE,
    y: 42 * TILE,
    hp: 100,
    maxHp: 100,
    level: 1,
    xp: 0,
    gold: 0,
    kills: 0,
    power: 1 + Math.floor(meta.renown / 35),
    appearance: cleanAppearance(appearance),
    hitbox: { radius: PLAYER_HITBOX_RADIUS },
    facing: 1,
    moving: false,
    aliveSince: Date.now(),
  };
}

function reviveAsHeir(player, name, house, appearance) {
  const meta = getMeta(player.accountId, house || player.house);
  const next = makeCharacter(name || randomHeirName(), meta.dynasty, meta, appearance || player.appearance);
  Object.assign(player, next, {
    meta,
    input: { dx: 0, dy: 0, attack: false, angle: 0 },
    attackCd: 0,
    portalCd: 1,
    dead: false,
  });
  player.ws.send(JSON.stringify({ t: "revived", meta }));
  savePersisted();
}

function tick() {
  for (const player of clients.values()) updatePlayer(player);
  cleanupEmptyCombatWorlds();
  updateEnemies();
  updateWorldEvent();
  updateCombatTexts();
  broadcastWorld();
}

function updatePlayer(player) {
  if (player.dead) return;
  const world = getWorld(player.world);
  if (!world) {
    movePlayerToWorld(player, "haven", 40 * TILE, 42 * TILE);
    return;
  }
  player.attackCd = Math.max(0, player.attackCd - DT);
  player.portalCd = Math.max(0, player.portalCd - DT);

  const len = Math.hypot(player.input.dx, player.input.dy) || 1;
  const dx = player.input.dx / len;
  const dy = player.input.dy / len;
  player.moving = Math.abs(dx) + Math.abs(dy) > 0.01 && (player.input.dx !== 0 || player.input.dy !== 0);
  if (Math.abs(dx) > 0.05) player.facing = dx > 0 ? 1 : -1;

  const tile = tileAt(world, player.x, player.y);
  const speed = tile === "marsh" ? 176 : 248;
  const nx = clamp(player.x + dx * speed * DT, TILE, WORLD_W * TILE - TILE);
  const ny = clamp(player.y + dy * speed * DT, TILE, WORLD_H * TILE - TILE);
  moveEntity(player, world, nx, ny);

  if (player.input.attack && player.attackCd <= 0) attack(player);
  collectLoot(player);
  maybeWarp(player);
}

function attack(player) {
  player.attackCd = 0.42;
  player.facing = Math.cos(player.input.angle) >= 0 ? 1 : -1;
  const world = getWorld(player.world);
  if (!isCombatWorld(world)) return;
  const attackSpec = getAttackSpec(player);
  const range = attackSpec.range;
  const halfWidth = attackSpec.halfWidth;
  const ax = Math.cos(player.input.angle);
  const ay = Math.sin(player.input.angle);
  const targets = [];
  for (const enemy of world.enemies) {
    const ex = enemy.x - player.x;
    const ey = enemy.y - player.y;
    const along = ex * ax + ey * ay;
    const radius = getMonsterHitbox(enemy.kind).radius;
    if (along < -radius || along > range + radius) continue;
    const side = Math.abs(ex * ay - ey * ax);
    if (side <= halfWidth + radius) targets.push({ enemy, along: Math.max(0, along - radius) });
  }
  if (targets.length === 0) return;

  const damage = 19 + player.level * 5 + player.power * 4;
  const dead = [];
  targets.sort((a, b) => a.along - b.along);
  for (const { enemy } of targets) {
    const dealt = Math.min(damage, Math.max(0, enemy.hp));
    enemy.hp -= damage;
    enemy.hitBy = player.id;
    addDamageText(world, enemy.x, enemy.y - 30, dealt);
    if (enemy.hp <= 0) dead.push(enemy);
  }

  for (const enemy of dead) {
    const index = world.enemies.indexOf(enemy);
    if (index === -1) continue;
    player.kills += 1;
    player.xp += enemy.level * 10;
    player.gold += 4 + enemy.level;
    if (rng() < getLootDropChance(world.depth)) world.loot.push(makeLoot(enemy.x, enemy.y, enemy.level >= 5 || rng() < getRareLootChance(world.depth), world.depth));
    world.enemies.splice(index, 1);
    world.enemies.push(makeEnemy(world.id, Math.floor(player.level / 2)));
    while (player.xp >= player.level * 26) levelUp(player);
  }
}

function levelUp(player) {
  player.xp = 0;
  player.level += 1;
  player.maxHp += 16;
  player.hp = player.maxHp;
  player.power += 1;
}

function collectLoot(player) {
  const world = getWorld(player.world);
  if (!isCombatWorld(world)) return;
  const loot = world.loot;
  for (let i = loot.length - 1; i >= 0; i -= 1) {
    const item = loot[i];
    if (distance(player, item) < 24) {
      player.gold += item.gold;
      player.power += item.power;
      loot.splice(i, 1);
    }
  }
}

function maybeWarp(player) {
  const world = getWorld(player.world);
  if (!world || player.portalCd > 0 || tileAt(world, player.x, player.y) !== "portal") return;
  const portal = getTouchedPortal(player);
  if (!portal) return;
  const oldWorld = player.world;
  const targetWorld = ensureWorldForTarget(portal.target);
  if (!targetWorld) return;
  movePlayerToWorld(player, targetWorld.id, portal.spawnX ?? 40 * TILE, portal.spawnY ?? 42 * TILE);
  if (portal.target === "haven") {
    player.hp = Math.min(player.maxHp, player.hp + 30);
  }
  player.portalCd = 1.2;
  cleanupEmptyCombatWorld(oldWorld);
}

function updateEnemies() {
  for (const world of activeCombatWorlds.values()) {
    const combatPlayers = [...clients.values()].filter((p) => !p.dead && p.world === world.id);
    if (combatPlayers.length === 0) continue;
    for (const enemy of world.enemies) {
      let target = null;
      let nearest = 9999;
      for (const player of combatPlayers) {
        const dist = distance(enemy, player);
        if (dist < nearest) {
          nearest = dist;
          target = player;
        }
      }

      let vx = Math.cos(enemy.wander);
      let vy = Math.sin(enemy.wander);
      if (target && nearest < 310) {
        vx = (target.x - enemy.x) / nearest;
        vy = (target.y - enemy.y) / nearest;
      } else if (rng() < 0.02) {
        enemy.wander = rng() * Math.PI * 2;
      }

      enemy.moving = true;
      if (Math.abs(vx) > 0.08) enemy.facing = vx > 0 ? 1 : -1;
      const nx = clamp(enemy.x + vx * enemy.speed * DT, TILE, WORLD_W * TILE - TILE);
      const ny = clamp(enemy.y + vy * enemy.speed * DT, TILE, WORLD_H * TILE - TILE);
      moveEntity(enemy, world, nx, ny);

      enemy.attackCd = Math.max(0, enemy.attackCd - DT);
      if (target && nearest < PLAYER_HITBOX_RADIUS + getMonsterHitbox(enemy.kind).radius && enemy.attackCd <= 0) {
        if (process.env.LEGACY_TEST_MODE !== "1") target.hp -= enemy.dmg;
        enemy.attackCd = 1.05;
        if (target.hp <= 0) killPlayer(target, enemy.name);
      }
    }
  }
}

function updateWorldEvent() {
  for (const world of activeCombatWorlds.values()) {
    const event = world.event;
    if (!event || event.spawned) continue;
    const near = [...clients.values()].some((p) => !p.dead && p.world === world.id && distance(p, event) < 170);
    if (!near) continue;
    event.spawned = true;
    const spawnCount = world.depth % 10 === 0 ? 10 : 6;
    for (let i = 0; i < spawnCount; i += 1) {
      const enemy = makeEnemy(world.id, world.depth % 10 === 0 ? 5 : 2);
      const point = randomPassablePointNear(world.id, event.x, event.y, 190, enemy.hitbox?.radius || 14);
      enemy.x = point.x;
      enemy.y = point.y;
      world.enemies.push(enemy);
    }
  }
}

function addDamageText(world, x, y, value) {
  world.combatTexts.push({
    id: cryptoId(),
    x: round2(x + (rng() - 0.5) * 14),
    y: round2(y + (rng() - 0.5) * 8),
    value: Math.max(1, Math.round(value)),
    born: Date.now(),
    life: 850,
  });
  if (world.combatTexts.length > 90) world.combatTexts.splice(0, world.combatTexts.length - 90);
}

function updateCombatTexts() {
  const now = Date.now();
  for (const world of getAllWorlds()) {
    world.combatTexts = world.combatTexts.filter((text) => now - text.born < text.life);
  }
}

function killPlayer(player, cause) {
  if (player.dead) return;
  const lifeSeconds = Math.max(1, Math.round((Date.now() - player.aliveSince) / 1000));
  const grave = {
    name: `${player.name} ${player.house}`,
    level: player.level,
    cause,
    lifeSeconds,
    kills: player.kills,
    gold: player.gold,
    date: new Date().toISOString(),
  };
  player.meta.graves.unshift(grave);
  player.meta.graves = player.meta.graves.slice(0, 30);
  player.meta.renown += player.level * 3 + player.kills + Math.floor(lifeSeconds / 30);
  player.meta.records.maxLevel = Math.max(player.meta.records.maxLevel, player.level);
  player.meta.records.longestLife = Math.max(player.meta.records.longestLife, lifeSeconds);
  player.meta.records.mostKills = Math.max(player.meta.records.mostKills, player.kills);

  if (player.level >= 3 || player.kills >= 8) {
    player.meta.relics.unshift({
      name: `${player.name}'s ${player.power > 6 ? "Relic Blade" : "Old Charm"}`,
      owner: player.name,
      kills: player.kills,
      owners: 1,
      date: new Date().toISOString(),
    });
    player.meta.relics = player.meta.relics.slice(0, 12);
  }

  persisted.graves.unshift(grave);
  persisted.graves = persisted.graves.slice(0, 80);
  persisted.relics.unshift(...player.meta.relics.slice(0, 1));
  persisted.relics = persisted.relics.slice(0, 40);
  const oldWorld = player.world;
  player.dead = true;
  player.ws.send(JSON.stringify({ t: "death", grave, meta: player.meta }));
  savePersisted();
  cleanupEmptyCombatWorld(oldWorld);
}

function broadcastWorld() {
  for (const player of clients.values()) {
    if (player.ws.readyState !== WebSocket.OPEN) continue;
    const changedWorld = player.sentWorld !== player.world;
    const snapshot = snapshotWorld(player.world, changedWorld);
    if (!snapshot) continue;
    player.sentWorld = player.world;
    player.ws.send(JSON.stringify({
      t: "state",
      selfId: player.id,
      world: player.world,
      meta: player.meta,
      snapshot,
      legends: publicLegends(),
    }));
  }
}

function snapshotWorld(worldId, includeTiles) {
  const world = getWorld(worldId);
  if (!world) return null;
  const snapshot = {
    id: worldId,
    name: world.name,
    depth: world.depth || 0,
    seed: world.seed || 0,
    portal: world.portal,
    portals: world.portals || (world.portal ? [world.portal] : []),
    event: world.event || null,
    players: [...clients.values()].filter((p) => !p.dead && p.world === worldId).map((p) => ({
      id: p.id,
      name: p.name,
      house: p.house,
      x: round2(p.x),
      y: round2(p.y),
      hp: Math.max(0, Math.round(p.hp)),
      maxHp: p.maxHp,
      level: p.level,
      xp: p.xp,
      gold: p.gold,
      kills: p.kills,
      power: p.power,
      appearance: p.appearance,
      facing: p.facing,
      moving: p.moving,
      attackCd: p.attackCd,
      attackAngle: p.input.angle,
      attackSpec: getAttackSpec(p),
    })),
    enemies: world.enemies.map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind || "orc",
      hitbox: e.hitbox || getMonsterHitbox(e.kind),
      x: round2(e.x),
      y: round2(e.y),
      hp: Math.max(0, Math.round(e.hp)),
      maxHp: e.maxHp,
      level: e.level,
      facing: e.facing,
      moving: e.moving,
      attackCd: e.attackCd,
    })),
    combatTexts: world.combatTexts.map((text) => ({
      id: text.id,
      x: text.x,
      y: text.y,
      value: text.value,
      age: Date.now() - text.born,
      life: text.life,
    })),
    loot: world.loot.map((l) => ({ id: l.id, name: l.name, x: round2(l.x), y: round2(l.y), gold: l.gold, rare: l.rare })),
  };
  if (includeTiles) snapshot.tiles = world.tiles;
  return snapshot;
}

function getTouchedPortal(player) {
  const world = getWorld(player.world);
  if (!world) return null;
  const tileX = Math.floor(player.x / TILE) * TILE;
  const tileY = Math.floor(player.y / TILE) * TILE;
  return (world.portals || [world.portal]).find((portal) => {
    if (!portal) return false;
    return Math.floor(portal.x / TILE) * TILE === tileX && Math.floor(portal.y / TILE) * TILE === tileY;
  });
}

function getWorld(worldId) {
  if (worldId === "haven") return worlds.haven;
  const depth = depthFromWorldId(worldId);
  return depth ? activeCombatWorlds.get(depth) || null : null;
}

function getAllWorlds() {
  return [worlds.haven, ...activeCombatWorlds.values()];
}

function ensureWorldForTarget(target) {
  if (target === "haven") return worlds.haven;
  const depth = depthFromWorldId(target);
  if (!depth) return null;
  return ensureCombatWorld(depth);
}

function ensureCombatWorld(depth) {
  const normalizedDepth = clamp(Math.floor(Number(depth) || 1), 1, MAX_DEPTH);
  const existing = activeCombatWorlds.get(normalizedDepth);
  if (existing) return existing;
  const world = createCombatWorld(normalizedDepth);
  activeCombatWorlds.set(normalizedDepth, world);
  return world;
}

function cleanupEmptyCombatWorld(worldId) {
  const depth = depthFromWorldId(worldId);
  if (!depth) return;
  const occupied = [...clients.values()].some((p) => !p.dead && p.world === combatWorldId(depth));
  if (!occupied) activeCombatWorlds.delete(depth);
}

function cleanupEmptyCombatWorlds() {
  for (const depth of activeCombatWorlds.keys()) cleanupEmptyCombatWorld(combatWorldId(depth));
}

function movePlayerToWorld(player, worldId, x, y) {
  player.world = worldId;
  player.x = x;
  player.y = y;
  player.sentWorld = null;
}

function combatWorldId(depth) {
  return depth === 1 ? COMBAT_WORLD_PREFIX : `${COMBAT_WORLD_PREFIX}${depth}`;
}

function depthFromWorldId(worldId) {
  if (worldId === COMBAT_WORLD_PREFIX) return 1;
  const match = String(worldId || "").match(/^combat(\d+)$/);
  if (!match) return 0;
  const depth = Number(match[1]);
  return depth >= 2 && depth <= MAX_DEPTH ? depth : 0;
}

function createCombatWorld(depth) {
  const biome = getBiome(depth);
  const id = combatWorldId(depth);
  const seed = ((Date.now() + instanceSerial * 9973 + depth * 104729) >>> 0) || 1;
  instanceSerial += 1;
  const map = { id, depth, seed, ...biome };
  const tiles = createWorld(id, map);
  const portals = [
    {
      x: 40 * TILE,
      y: 72 * TILE,
      target: depth === 1 ? "haven" : combatWorldId(depth - 1),
      label: depth === 1 ? "Back to haven" : `Back to depth ${depth - 1}`,
      spawnX: depth === 1 ? 40 * TILE : 40 * TILE,
      spawnY: depth === 1 ? 43 * TILE : 70 * TILE,
    },
  ];
  if (depth < MAX_DEPTH) {
    portals.push({ x: map.exitX * TILE, y: map.exitY * TILE, target: combatWorldId(depth + 1), label: `Depth ${depth + 1}`, spawnX: 40 * TILE, spawnY: 70 * TILE });
  }
  const world = {
    id,
    name: `${biome.name} Depth ${depth}`,
    depth,
    seed,
    tiles,
    enemies: [],
    loot: [],
    combatTexts: [],
    portals,
    portal: portals[0],
    event: depth === 1 || depth % 10 === 0 ? { name: depth % 10 === 0 ? "Depth Rift" : "Ash Portal", x: map.eventX * TILE, y: map.eventY * TILE, pulse: 0, spawned: false } : null,
  };
  activeCombatWorlds.set(depth, world);
  populateCombatWorld(world);
  return world;
}

function populateCombatWorld(world) {
  const enemyCount = getEnemyCount(world.depth);
  for (let i = 0; i < enemyCount; i += 1) world.enemies.push(makeEnemy(world.id));
  const lootCount = Math.min(48, 16 + Math.floor(world.depth * 0.32));
  for (let i = 0; i < lootCount; i += 1) {
    const point = randomPassablePoint(world.id);
    world.loot.push(makeLoot(point.x, point.y, rng() < getRareLootChance(world.depth), world.depth));
  }
}

function getBiome(depth) {
  const tier = Math.floor((depth - 1) / 10);
  return BIOMES[(depth + tier - 1) % BIOMES.length];
}

function getEnemyCount(depth) {
  return clamp(24 + Math.floor(depth * 0.56), 24, 80);
}

function getRareLootChance(depth) {
  return clamp(0.08 + depth * 0.0045, 0.08, 0.58);
}

function getLootDropChance(depth) {
  return clamp(0.25 + depth * 0.0015, 0.25, 0.4);
}

function isCombatWorld(world) {
  return Boolean(world && world.depth > 0);
}

function getAttackSpec(player) {
  return {
    shape: BASE_ATTACK.shape,
    range: BASE_ATTACK.range,
    halfWidth: BASE_ATTACK.halfWidth,
  };
}

function publicLegends() {
  const accounts = Object.values(persisted.accounts);
  const records = accounts.reduce((acc, meta) => {
    acc.maxLevel = Math.max(acc.maxLevel, meta.records.maxLevel || 1);
    acc.longestLife = Math.max(acc.longestLife, meta.records.longestLife || 0);
    acc.mostKills = Math.max(acc.mostKills, meta.records.mostKills || 0);
    if (meta.generation > acc.oldestDynasty.generation) acc.oldestDynasty = { dynasty: meta.dynasty, generation: meta.generation };
    return acc;
  }, { maxLevel: 1, longestLife: 0, mostKills: 0, oldestDynasty: { dynasty: "-", generation: 0 } });

  return {
    records,
    graves: persisted.graves.slice(0, 8),
    relics: persisted.relics.slice(0, 8),
    online: clients.size,
  };
}

function createWorld(kind, mapDefinition = null) {
  const tiles = Array.from({ length: WORLD_H }, () => Array.from({ length: WORLD_W }, () => (kind === "haven" ? "forest" : mapDefinition?.wall || "wall")));

  if (kind === "haven") {
    paintEllipse(40, 41, 26, 21, "grass");
    paintEllipse(40, 41, 16, 13, "grass");
    paintRoad(40, 42, 40, 35, "path", 1);
    paintRoad(40, 42, 26, 42, "path", 1);
    paintRoad(40, 42, 54, 42, "path", 1);
    paintRoad(40, 42, 40, 56, "path", 1);
    paintRect(31, 33, 19, 15, "village");
    paintRect(38, 36, 5, 11, "path");
    paintRect(35, 40, 11, 5, "path");
    paintRect(26, 35, 5, 5, "village");
    paintRect(50, 35, 5, 5, "village");
    paintRect(34, 30, 13, 6, "village");
    paintRect(38, 36, 5, 2, "path");
    paintRect(40, 36, 1, 1, "portal");
    scatter("grass", "grave", 7, 27, 50, 54, 60);
    scatter("grass", "path", 12, 29, 51, 54, 62);
    return tiles;
  }

  if (mapDefinition) {
    const map = mapDefinition;
    const localRng = mulberry32(map.seed);
    const floor = map.floor;
    const accent = map.accent;
    const hazard = map.hazard;
    let generated = false;
    for (let attempt = 0; attempt < 6 && !generated; attempt += 1) {
      fillTiles(map.wall || "wall");
      const variant = (map.depth + attempt + Math.floor(localRng() * 99)) % 4;
      const exitX = variant === 0 ? 18 + Math.floor(localRng() * 12) : variant === 1 ? 50 + Math.floor(localRng() * 12) : 35 + Math.floor(localRng() * 12);
      const exitY = variant === 3 ? 16 + Math.floor(localRng() * 10) : 8 + Math.floor(localRng() * 6);
      const mainPath = buildMainPath(40, 72, exitX, exitY, variant, localRng);
      const rooms = buildRooms(mainPath, floor, accent, localRng);
      for (const room of rooms) carveRoom(room);
      for (let i = 1; i < mainPath.length; i += 1) {
        const prev = mainPath[i - 1];
        const next = mainPath[i];
        carveCorridor(prev.x, prev.y, next.x, next.y, i % 2 === 0 ? floor : accent, 2);
      }
      carveBranches(mainPath, floor, accent, localRng);
      addHazards(hazard, localRng);
      protectSpawnAndPortals(floor, exitX, exitY, map.depth >= MAX_DEPTH);
      paintRect(40, 72, 1, 1, "portal");
      if (map.depth < MAX_DEPTH) paintRect(exitX, exitY, 1, 1, "portal");
      map.exitX = exitX;
      map.exitY = exitY;
      map.eventX = mainPath[Math.floor(mainPath.length / 2)].x;
      map.eventY = mainPath[Math.floor(mainPath.length / 2)].y;
      scatter(floor, "rubble", 16 + Math.floor(map.depth * 0.7), 8, 71, 8, 72, localRng);
      scatter(accent, accent === "tomb" ? "grave" : "tomb", 10 + Math.floor(map.depth * 0.35), 8, 71, 8, 72, localRng);
      if (map.wall === "forest") scatter("grass", "forest", 28, 7, 72, 8, 72, localRng);
      softenWallCorners();
      generated = validateCombatMap(40, 72, exitX, exitY, map.depth >= MAX_DEPTH);
    }
    if (!generated) {
      fillTiles(map.wall || "wall");
      const fallbackPath = [
        { x: 40, y: 72 },
        { x: 28, y: 62 },
        { x: 54, y: 50 },
        { x: 25, y: 35 },
        { x: 56, y: 22 },
        { x: 40, y: 10 },
      ];
      for (const point of fallbackPath) carveRoom({ x: point.x - 6, y: point.y - 4, w: 13, h: 9, tile: floor });
      for (let i = 1; i < fallbackPath.length; i += 1) carveCorridor(fallbackPath[i - 1].x, fallbackPath[i - 1].y, fallbackPath[i].x, fallbackPath[i].y, floor, 2);
      protectSpawnAndPortals(floor, 40, 10, map.depth >= MAX_DEPTH);
      paintRect(40, 72, 1, 1, "portal");
      if (map.depth < MAX_DEPTH) paintRect(40, 10, 1, 1, "portal");
      map.exitX = 40;
      map.exitY = 10;
      map.eventX = 54;
      map.eventY = 50;
      softenWallCorners();
    }
  }
  return tiles;

  function fillTiles(tile) {
    for (let y = 0; y < WORLD_H; y += 1) {
      for (let x = 0; x < WORLD_W; x += 1) tiles[y][x] = tile;
    }
  }

  function buildMainPath(startX, startY, exitX, exitY, variant, rand) {
    const bendA = variant % 2 === 0 ? 18 + Math.floor(rand() * 12) : 50 + Math.floor(rand() * 12);
    const bendB = variant % 2 === 0 ? 56 + Math.floor(rand() * 10) : 18 + Math.floor(rand() * 10);
    const midY = 39 + Math.floor(rand() * 8) - 4;
    const path = [
      { x: startX, y: startY },
      { x: bendA, y: 62 + Math.floor(rand() * 6) - 3 },
      { x: bendA, y: midY },
      { x: bendB, y: midY - 9 + Math.floor(rand() * 7) },
      { x: bendB, y: 20 + Math.floor(rand() * 8) },
      { x: exitX, y: exitY },
    ];
    return path.map((point) => ({
      x: clamp(Math.round(point.x), 9, 70),
      y: clamp(Math.round(point.y), 8, 72),
    }));
  }

  function buildRooms(path, floor, accent, rand) {
    return path.map((point, index) => ({
      x: clamp(point.x - 6 - Math.floor(rand() * 3), 4, 63),
      y: clamp(point.y - 4 - Math.floor(rand() * 2), 4, 69),
      w: 12 + Math.floor(rand() * 7),
      h: 9 + Math.floor(rand() * 6),
      tile: index % 2 === 0 ? floor : accent,
    }));
  }

  function carveBranches(path, floor, accent, rand) {
    const branchCount = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < branchCount; i += 1) {
      const anchor = path[1 + Math.floor(rand() * Math.max(1, path.length - 2))];
      const dir = rand() > 0.5 ? 1 : -1;
      const endX = clamp(anchor.x + dir * (12 + Math.floor(rand() * 15)), 8, 71);
      const endY = clamp(anchor.y + Math.floor(rand() * 19) - 9, 8, 71);
      carveCorridor(anchor.x, anchor.y, endX, endY, i % 2 === 0 ? floor : accent, 1);
      carveRoom({ x: clamp(endX - 4, 4, 68), y: clamp(endY - 3, 4, 70), w: 9, h: 7, tile: i % 2 === 0 ? accent : floor });
    }
  }

  function addHazards(hazard, rand) {
    const hazardCount = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < hazardCount; i += 1) {
      paintEllipse(12 + Math.floor(rand() * 56), 15 + Math.floor(rand() * 50), 3 + Math.floor(rand() * 5), 2 + Math.floor(rand() * 4), hazard);
    }
    if (hazard === "water" && rand() > 0.45) {
      const cx = 18 + Math.floor(rand() * 44);
      carveRiver(cx);
      for (let y = 18; y <= 62; y += 16) paintBridge(cx - 5, y, cx + 5, y);
    }
  }

  function protectSpawnAndPortals(floor, exitX, exitY, finalDepth) {
    paintRect(38, 69, 5, 5, floor);
    paintRect(40, 72, 1, 1, "portal");
    if (!finalDepth) {
      paintRect(exitX - 2, exitY - 2, 5, 5, floor);
      paintRect(exitX, exitY, 1, 1, "portal");
    }
  }

  function validateCombatMap(entryX, entryY, exitX, exitY, finalDepth) {
    if (isBlockedTile(tileAtGrid(40, 70))) return false;
    if (!isReachable(40, 70, entryX, entryY)) return false;
    if (!finalDepth && !isReachable(40, 70, exitX, exitY)) return false;
    if (!isReachable(entryX, entryY, exitX, exitY)) return false;
    if (finalDepth) return true;
    const pathDistance = shortestPathDistance(40, 70, exitX, exitY);
    const directDistance = Math.hypot(exitX - 40, exitY - 70);
    return pathDistance > directDistance * 1.35 && pathDistance > 80;
  }

  function isReachable(fromX, fromY, toX, toY) {
    return shortestPathDistance(fromX, fromY, toX, toY) < Infinity;
  }

  function shortestPathDistance(fromX, fromY, toX, toY) {
    const queue = [{ x: fromX, y: fromY, d: 0 }];
    const seen = new Set([`${fromX},${fromY}`]);
    for (let i = 0; i < queue.length; i += 1) {
      const current = queue[i];
      if (current.x === toX && current.y === toY) return current.d;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = current.x + ox;
        const ny = current.y + oy;
        const key = `${nx},${ny}`;
        if (!inBounds(nx, ny) || seen.has(key) || isBlockedTile(tileAtGrid(nx, ny))) continue;
        seen.add(key);
        queue.push({ x: nx, y: ny, d: current.d + 1 });
      }
    }
    return Infinity;
  }

  function carveRoom(room) {
    paintRect(room.x, room.y, room.w, room.h, room.tile);
    for (let x = room.x; x < room.x + room.w; x += 1) {
      setTile(x, room.y, "wall");
      setTile(x, room.y + room.h - 1, "wall");
    }
    for (let y = room.y; y < room.y + room.h; y += 1) {
      setTile(room.x, y, "wall");
      setTile(room.x + room.w - 1, y, "wall");
    }
    paintRect(room.x + 1, room.y + 1, room.w - 2, room.h - 2, room.tile);
  }

  function carveCorridor(x1, y1, x2, y2, tile, radius) {
    paintRoad(x1, y1, x2, y1, tile, radius);
    paintRoad(x2, y1, x2, y2, tile, radius);
  }

  function carveRiver(cx) {
    for (let y = 8; y < 72; y += 1) {
      const center = cx + Math.round(Math.sin(y * 0.22) * 2);
      for (let x = center - 2; x <= center + 2; x += 1) setTile(x, y, "water");
      for (let x = center - 4; x <= center + 4; x += 1) {
        if (tileAtGrid(x, y) !== "water" && tileAtGrid(x, y) !== "bridge") setTile(x, y, "marsh");
      }
    }
  }

  function softenWallCorners() {
    for (let y = 1; y < WORLD_H - 1; y += 1) {
      for (let x = 1; x < WORLD_W - 1; x += 1) {
        if (tileAtGrid(x, y) !== "wall") continue;
        const floorNeighbours = [
          tileAtGrid(x + 1, y),
          tileAtGrid(x - 1, y),
          tileAtGrid(x, y + 1),
          tileAtGrid(x, y - 1),
        ].filter((tile) => tile && !isBlockedTile(tile)).length;
        if (floorNeighbours >= 3) setTile(x, y, "rubble");
      }
    }
  }

  function paintRect(x, y, width, height, tile) {
    for (let yy = y; yy < y + height; yy += 1) {
      for (let xx = x; xx < x + width; xx += 1) setTile(xx, yy, tile);
    }
  }

  function hollowRect(x, y, width, height, wallTile, floorTile) {
    paintRect(x, y, width, height, wallTile);
    paintRect(x + 1, y + 1, width - 2, height - 2, floorTile);
  }

  function paintEllipse(cx, cy, rx, ry, tile) {
    for (let y = cy - ry; y <= cy + ry; y += 1) {
      for (let x = cx - rx; x <= cx + rx; x += 1) {
        if (!inBounds(x, y)) continue;
        const normalized = ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2);
        if (normalized <= 1 && tiles[y][x] !== "water") tiles[y][x] = tile;
      }
    }
  }

  function paintRoad(x1, y1, x2, y2, tile, radius) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i += 1) {
      const x = Math.round(x1 + (x2 - x1) * (i / steps));
      const y = Math.round(y1 + (y2 - y1) * (i / steps));
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          if (inBounds(x + ox, y + oy) && tiles[y + oy][x + ox] !== "water") tiles[y + oy][x + ox] = tile;
        }
      }
    }
  }

  function paintBridge(x1, y1, x2, y2) {
    for (let y = y1 - 1; y <= y1 + 1; y += 1) {
      for (let x = x1; x <= x2; x += 1) {
        if (inBounds(x, y)) tiles[y][x] = "bridge";
      }
    }
  }

  function scatter(onTile, paintTile, count, minX, maxX, minY, maxY, rand = rng) {
    for (let i = 0; i < count; i += 1) {
      const x = minX + Math.floor(rand() * (maxX - minX + 1));
      const y = minY + Math.floor(rand() * (maxY - minY + 1));
      if (tileAtGrid(x, y) === onTile) setTile(x, y, paintTile);
    }
  }

  function setTile(x, y, tile) {
    if (inBounds(x, y)) tiles[y][x] = tile;
  }

  function tileAtGrid(x, y) {
    return inBounds(x, y) ? tiles[y][x] : null;
  }

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H;
  }
}

function isCombatWorldDefinition(kind) {
  return depthFromWorldId(kind) > 0;
}

function makeEnemy(worldId = "combat", levelBoost = 0) {
  const world = getWorld(worldId);
  const depth = world?.depth || 1;
  const kind = pickMonsterKind(depth);
  const hitbox = getMonsterHitbox(kind);
  const names = MONSTER_NAMES[kind] || ["Orc Scout", "Orc Brute", "Orc Raider", "Orc Guard", "Orc Warlord"];
  const elite = rng() < clamp(0.04 + depth * 0.003, 0.04, 0.34);
  const level = 1 + Math.floor(rng() * 4) + levelBoost + Math.floor((depth - 1) * 1.45) + (elite ? 3 + Math.floor(depth / 18) : 0);
  const point = randomPassablePoint(worldId, hitbox.radius);
  const hp = Math.round((28 + level * 12 + depth * 8) * (elite ? 1.85 : 1));
  return {
    id: cryptoId(),
    name: `${elite ? "Elite " : ""}${names[Math.floor(rng() * names.length)]}`,
    kind,
    hitbox,
    x: point.x,
    y: point.y,
    level,
    hp,
    maxHp: hp,
    dmg: Math.round((5 + level * 2.5 + depth * 0.7) * (elite ? 1.45 : 1)),
    speed: Math.min(188, (38 + rng() * 22 + depth * 0.38 + (elite ? 8 : 0)) * 2),
    attackCd: 0,
    wander: rng() * Math.PI * 2,
    moving: false,
    facing: rng() > 0.5 ? 1 : -1,
  };
}

function getMonsterHitbox(kind) {
  return MONSTER_HITBOXES[kind] || MONSTER_HITBOXES.orc;
}

function pickMonsterKind(depth) {
  const table = depth >= 60
    ? [["cinderBrute", 48], ["graveWraith", 38], ["marshMaw", 10], ["ruinCrawler", 4]]
    : depth >= 30
      ? [["graveWraith", 40], ["cinderBrute", 35], ["marshMaw", 17], ["ruinCrawler", 8]]
      : depth >= 10
        ? [["marshMaw", 48], ["ruinCrawler", 22], ["graveWraith", 20], ["cinderBrute", 10]]
        : [["ruinCrawler", 62], ["marshMaw", 24], ["graveWraith", 14]];
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [kind, weight] of table) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return table[0][0];
}

function makeLoot(x, y, rare = false, depth = 1) {
  const names = rare ? ["Greyfall Blade", "Ashen Crown", "Saint's Lantern"] : ["Iron Ring", "Old Coin", "Hunter Cloak", "Rusty Sword"];
  return {
    id: cryptoId(),
    name: names[Math.floor(rng() * names.length)],
    x,
    y,
    gold: rare ? 35 + depth * 2 + Math.floor(rng() * 70) : 5 + Math.floor(depth * 0.7) + Math.floor(rng() * 22),
    power: rare ? 2 + Math.floor(depth / 35) : 1,
    rare,
  };
}

function getMeta(accountId, house) {
  if (!persisted.accounts[accountId]) {
    persisted.accounts[accountId] = {
      dynasty: cleanName(house, "Valen"),
      generation: 0,
      renown: 0,
      graves: [],
      relics: [],
      records: { maxLevel: 1, longestLife: 0, mostKills: 0 },
    };
  }
  if (house) persisted.accounts[accountId].dynasty = cleanName(house, persisted.accounts[accountId].dynasty);
  return persisted.accounts[accountId];
}

function loadPersisted() {
  try {
    return JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
  } catch {
    return { accounts: {}, graves: [], relics: [] };
  }
}

function savePersisted() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SAVE_FILE, JSON.stringify(persisted, null, 2));
}

function sendJson(res, body) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function tileAt(world, x, y) {
  const tx = clamp(Math.floor(x / TILE), 0, WORLD_W - 1);
  const ty = clamp(Math.floor(y / TILE), 0, WORLD_H - 1);
  return world.tiles[ty][tx];
}

function moveEntity(entity, world, nx, ny) {
  const radius = entity.hitbox?.radius || 12;
  if (isWalkableAt(world, nx, entity.y, radius)) entity.x = nx;
  if (isWalkableAt(world, entity.x, ny, radius)) entity.y = ny;
}

function isWalkableAt(world, x, y, radius = 10) {
  const probes = [
    [x, y],
    [x - radius, y - radius],
    [x + radius, y - radius],
    [x - radius, y + radius],
    [x + radius, y + radius],
  ];
  return probes.every(([px, py]) => !isBlockedTile(tileAt(world, px, py)));
}

function isBlockedTile(tile) {
  return tile === "wall" || tile === "forest" || tile === "water";
}

function randomPassablePoint(worldId, radius = 14) {
  const world = getWorld(worldId);
  for (let i = 0; i < 800; i += 1) {
    const x = TILE + rng() * (WORLD_W * TILE - TILE * 2);
    const y = TILE + rng() * (WORLD_H * TILE - TILE * 2);
    if (isWalkableAt(world, x, y, radius)) return { x, y };
  }
  return { x: 42 * TILE, y: 45 * TILE };
}

function randomPassablePointNear(worldId, x, y, radius, entityRadius = 14) {
  const world = getWorld(worldId);
  for (let i = 0; i < 300; i += 1) {
    const angle = rng() * Math.PI * 2;
    const dist = rng() * radius;
    const px = clamp(x + Math.cos(angle) * dist, TILE, WORLD_W * TILE - TILE);
    const py = clamp(y + Math.sin(angle) * dist, TILE, WORLD_H * TILE - TILE);
    if (isWalkableAt(world, px, py, entityRadius)) return { x: px, y: py };
  }
  return randomPassablePoint(worldId, entityRadius);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function cleanName(value, fallback) {
  const clean = String(value || "").replace(/[^\w -]/g, "").trim().slice(0, 18);
  return clean || fallback;
}

function cleanId(value) {
  return String(value || "").replace(/[^\w-]/g, "").slice(0, 48);
}

function cleanAppearance(value) {
  const source = value && typeof value === "object" ? value : {};
  const appearance = {};
  for (const slot of characterCatalog.renderOrder) {
    const slotDef = characterCatalog.slots[slot];
    const allowed = slotDef.items.map((item) => item.id);
    appearance[slot] = pick(source[slot], allowed, slotDef.default || (slot === "body" ? "human" : "none"));
  }
  if (appearance.helmet !== "none") appearance.hat = "none";
  return appearance;
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function loadCharacterCatalog() {
  try {
    const catalog = JSON.parse(fs.readFileSync(CHARACTER_CATALOG_FILE, "utf8"));
    return {
      renderOrder: Array.isArray(catalog.renderOrder) ? catalog.renderOrder : ["body", "armor", "helmet", "weapon", "shield", "cape", "mount"],
      slots: Object.fromEntries(Object.entries(catalog.slots || {}).map(([slot, def]) => [
        slot,
        {
          default: def.default || (slot === "body" ? "human" : "none"),
          items: Array.isArray(def.items) && def.items.length ? def.items : [{ id: slot === "body" ? "human" : "none" }],
        },
      ])),
    };
  } catch {
    return {
      renderOrder: ["body", "skin", "hair", "armor", "helmet", "hat", "weapon", "shield", "cape", "mount", "pet", "aura"],
      slots: {
        body: { default: "human", items: [{ id: "human" }] },
        skin: { default: "pale", items: [{ id: "pale" }, { id: "tan" }, { id: "dark" }] },
        hair: { default: "short", items: [{ id: "none" }, { id: "short" }, { id: "long" }, { id: "wild" }] },
        armor: { default: "leather", items: [{ id: "none" }, { id: "leather" }, { id: "iron" }, { id: "dark" }] },
        helmet: { default: "none", items: [{ id: "none" }, { id: "ironCap" }, { id: "horned" }, { id: "hood" }] },
        hat: { default: "travelerHat", items: [{ id: "none" }, { id: "travelerHat" }, { id: "witchHat" }, { id: "crown" }] },
        weapon: { default: "sword", items: [{ id: "none" }, { id: "sword" }, { id: "axe" }, { id: "staff" }] },
        shield: { default: "round", items: [{ id: "none" }, { id: "round" }, { id: "tower" }] },
        cape: { default: "red", items: [{ id: "none" }, { id: "red" }, { id: "blue" }, { id: "green" }, { id: "tornBlack" }] },
        mount: { default: "none", items: [{ id: "none" }, { id: "horseBrown" }, { id: "horseGrey" }, { id: "blackHorse" }] },
        pet: { default: "none", items: [{ id: "none" }] },
        aura: { default: "none", items: [{ id: "none" }] },
      },
    };
  }
}

function cryptoId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function randomHeirName() {
  return ["Aren", "Mira", "Rowan", "Sel", "Tarin", "Edda", "Brann"][Math.floor(rng() * 7)];
}

function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

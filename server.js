const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocket, WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const SAVE_FILE = path.join(DATA_DIR, "legacy-state.json");
const TILE = 32;
const WORLD_W = 80;
const WORLD_H = 80;
const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const BASE_ATTACK = {
  shape: "rectangle",
  range: 78,
  halfWidth: 18,
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const persisted = loadPersisted();
const rng = mulberry32(921337);
const worlds = {
  haven: {
    id: "haven",
    name: "Haven",
    tiles: createWorld("haven"),
    enemies: [],
    loot: [],
    combatTexts: [],
    portal: { x: 40 * TILE, y: 36 * TILE, target: "combat", label: "To the ruins" },
  },
  combat: {
    id: "combat",
    name: "Combat Ruins",
    tiles: createWorld("combat"),
    enemies: [],
    loot: [],
    combatTexts: [],
    portal: { x: 42 * TILE, y: 42 * TILE, target: "haven", label: "Back to haven" },
    event: { name: "Ash Portal", x: 20 * TILE, y: 18 * TILE, pulse: 0, spawned: false },
  },
};

for (let i = 0; i < 32; i += 1) worlds.combat.enemies.push(makeEnemy());
for (let i = 0; i < 26; i += 1) {
  const point = randomPassablePoint("combat");
  worlds.combat.loot.push(makeLoot(point.x, point.y));
}

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
      return;
    }

    if (msg.t === "newHeir") {
      reviveAsHeir(player, msg.name, msg.house, msg.appearance);
    }
  });

  ws.on("close", () => {
    if (player) clients.delete(player.id);
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
  updateEnemies();
  updateWorldEvent();
  updateCombatTexts();
  broadcastWorld();
}

function updatePlayer(player) {
  if (player.dead) return;
  const world = worlds[player.world];
  player.attackCd = Math.max(0, player.attackCd - DT);
  player.portalCd = Math.max(0, player.portalCd - DT);

  const len = Math.hypot(player.input.dx, player.input.dy) || 1;
  const dx = player.input.dx / len;
  const dy = player.input.dy / len;
  player.moving = Math.abs(dx) + Math.abs(dy) > 0.01 && (player.input.dx !== 0 || player.input.dy !== 0);
  if (Math.abs(dx) > 0.05) player.facing = dx > 0 ? 1 : -1;

  const tile = tileAt(world, player.x, player.y);
  const speed = tile === "marsh" ? 88 : 124;
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
  if (player.world !== "combat") return;
  const attackSpec = getAttackSpec(player);
  const range = attackSpec.range;
  const hitRadius = attackSpec.halfWidth;
  const ax = Math.cos(player.input.angle);
  const ay = Math.sin(player.input.angle);
  const targets = [];
  for (const enemy of worlds.combat.enemies) {
    const ex = enemy.x - player.x;
    const ey = enemy.y - player.y;
    const along = ex * ax + ey * ay;
    if (along < 0 || along > range) continue;
    const side = Math.abs(ex * ay - ey * ax);
    if (side <= hitRadius) targets.push({ enemy, along });
  }
  if (targets.length === 0) return;

  const damage = 19 + player.level * 5 + player.power * 4;
  const dead = [];
  targets.sort((a, b) => a.along - b.along);
  for (const { enemy } of targets) {
    const dealt = Math.min(damage, Math.max(0, enemy.hp));
    enemy.hp -= damage;
    enemy.hitBy = player.id;
    addDamageText(worlds.combat, enemy.x, enemy.y - 30, dealt);
    if (enemy.hp <= 0) dead.push(enemy);
  }

  for (const enemy of dead) {
    const index = worlds.combat.enemies.indexOf(enemy);
    if (index === -1) continue;
    player.kills += 1;
    player.xp += enemy.level * 10;
    player.gold += 4 + enemy.level;
    if (rng() < 0.32) worlds.combat.loot.push(makeLoot(enemy.x, enemy.y, enemy.level >= 5));
    worlds.combat.enemies.splice(index, 1);
    worlds.combat.enemies.push(makeEnemy(Math.floor(player.level / 2)));
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
  if (player.world !== "combat") return;
  const loot = worlds.combat.loot;
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
  const portal = worlds[player.world].portal;
  if (player.portalCd > 0 || tileAt(worlds[player.world], player.x, player.y) !== "portal") return;
  if (portal.target === "combat") {
    player.world = "combat";
    player.x = 42 * TILE;
    player.y = 45 * TILE;
  } else {
    player.world = "haven";
    player.x = 40 * TILE;
    player.y = 43 * TILE;
    player.hp = Math.min(player.maxHp, player.hp + 30);
  }
  player.portalCd = 1.2;
}

function updateEnemies() {
  const combatPlayers = [...clients.values()].filter((p) => !p.dead && p.world === "combat");
  for (const enemy of worlds.combat.enemies) {
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
    moveEntity(enemy, worlds.combat, nx, ny);

    enemy.attackCd = Math.max(0, enemy.attackCd - DT);
    if (target && nearest < 28 && enemy.attackCd <= 0) {
      target.hp -= enemy.dmg;
      enemy.attackCd = 1.05;
      if (target.hp <= 0) killPlayer(target, enemy.name);
    }
  }
}

function updateWorldEvent() {
  const event = worlds.combat.event;
  if (!event || event.spawned) return;
  const near = [...clients.values()].some((p) => !p.dead && p.world === "combat" && distance(p, event) < 170);
  if (!near) return;
  event.spawned = true;
  for (let i = 0; i < 8; i += 1) {
    const enemy = makeEnemy(3);
    const point = randomPassablePointNear("combat", event.x, event.y, 190);
    enemy.x = point.x;
    enemy.y = point.y;
    worlds.combat.enemies.push(enemy);
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
  for (const world of Object.values(worlds)) {
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
  player.dead = true;
  player.ws.send(JSON.stringify({ t: "death", grave, meta: player.meta }));
  savePersisted();
}

function broadcastWorld() {
  const snapshots = {
    haven: snapshotWorld("haven", false),
    combat: snapshotWorld("combat", false),
  };

  for (const player of clients.values()) {
    if (player.ws.readyState !== WebSocket.OPEN) continue;
    const changedWorld = player.sentWorld !== player.world;
    const snapshot = changedWorld ? snapshotWorld(player.world, true) : snapshots[player.world];
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
  const world = worlds[worldId];
  const snapshot = {
    id: worldId,
    name: world.name,
    portal: world.portal,
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

function createWorld(kind) {
  const tiles = Array.from({ length: WORLD_H }, () => Array.from({ length: WORLD_W }, () => (kind === "haven" ? "forest" : "wall")));

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

  if (kind === "combat") {
    const rooms = [
      { x: 34, y: 35, w: 17, h: 16, tile: "ruin" },
      { x: 15, y: 12, w: 13, h: 12, tile: "ruin" },
      { x: 11, y: 40, w: 13, h: 15, tile: "grave" },
      { x: 26, y: 55, w: 16, h: 11, tile: "grave" },
      { x: 49, y: 16, w: 15, h: 11, tile: "ruin" },
      { x: 55, y: 36, w: 15, h: 14, tile: "ruin" },
      { x: 49, y: 57, w: 16, h: 11, tile: "ruin" },
      { x: 29, y: 16, w: 12, h: 10, tile: "ruin" },
    ];
    for (const room of rooms) carveRoom(room);
    carveCorridor(42, 43, 21, 18, "ruin", 2);
    carveCorridor(42, 43, 18, 47, "ruin", 2);
    carveCorridor(42, 43, 34, 60, "ruin", 2);
    carveCorridor(42, 43, 56, 22, "ruin", 2);
    carveCorridor(42, 43, 62, 43, "ruin", 2);
    carveCorridor(42, 43, 57, 62, "ruin", 2);
    carveCorridor(35, 21, 21, 18, "ruin", 1);
    carveRiver(58);
    paintBridge(54, 22, 62, 22);
    paintBridge(54, 43, 62, 43);
    paintBridge(53, 62, 61, 62);
    paintRect(42, 42, 1, 1, "portal");
    paintEllipse(20, 18, 1, 1, "portal");
    paintEllipse(20, 18, 5, 4, "ruin");
    paintEllipse(30, 60, 7, 4, "grave");
    scatter("ruin", "rubble", 35, 10, 70, 10, 70);
    scatter("grave", "tomb", 22, 9, 43, 38, 67);
    softenWallCorners();
  }
  return tiles;

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

  function scatter(onTile, paintTile, count, minX, maxX, minY, maxY) {
    for (let i = 0; i < count; i += 1) {
      const x = minX + Math.floor(rng() * (maxX - minX + 1));
      const y = minY + Math.floor(rng() * (maxY - minY + 1));
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

function makeEnemy(levelBoost = 0) {
  const names = ["Orc Scout", "Orc Brute", "Bone Knight", "Marsh Wight", "Ash Cultist"];
  const level = 1 + Math.floor(rng() * 5) + levelBoost;
  const point = randomPassablePoint("combat");
  return {
    id: cryptoId(),
    name: names[Math.floor(rng() * names.length)],
    x: point.x,
    y: point.y,
    level,
    hp: 30 + level * 13,
    maxHp: 30 + level * 13,
    dmg: 6 + level * 3,
    speed: 38 + rng() * 25,
    attackCd: 0,
    wander: rng() * Math.PI * 2,
    moving: false,
    facing: rng() > 0.5 ? 1 : -1,
  };
}

function makeLoot(x, y, rare = false) {
  const names = rare ? ["Greyfall Blade", "Ashen Crown", "Saint's Lantern"] : ["Iron Ring", "Old Coin", "Hunter Cloak", "Rusty Sword"];
  return {
    id: cryptoId(),
    name: names[Math.floor(rng() * names.length)],
    x,
    y,
    gold: rare ? 45 + Math.floor(rng() * 60) : 5 + Math.floor(rng() * 20),
    power: rare ? 2 : 1,
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
  const radius = 12;
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

function randomPassablePoint(worldId) {
  const world = worlds[worldId];
  for (let i = 0; i < 800; i += 1) {
    const x = TILE + rng() * (WORLD_W * TILE - TILE * 2);
    const y = TILE + rng() * (WORLD_H * TILE - TILE * 2);
    if (isWalkableAt(world, x, y, 14)) return { x, y };
  }
  return { x: 42 * TILE, y: 45 * TILE };
}

function randomPassablePointNear(worldId, x, y, radius) {
  const world = worlds[worldId];
  for (let i = 0; i < 300; i += 1) {
    const angle = rng() * Math.PI * 2;
    const dist = rng() * radius;
    const px = clamp(x + Math.cos(angle) * dist, TILE, WORLD_W * TILE - TILE);
    const py = clamp(y + Math.sin(angle) * dist, TILE, WORLD_H * TILE - TILE);
    if (isWalkableAt(world, px, py, 14)) return { x: px, y: py };
  }
  return randomPassablePoint(worldId);
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
  return {
    body: pick(source.body, ["soldier"], "soldier"),
    armor: pick(source.armor, ["none", "leather", "iron", "dark"], "leather"),
    helmet: pick(source.helmet, ["none", "ironCap", "horned", "hood"], "ironCap"),
    weapon: pick(source.weapon, ["none", "sword", "axe", "staff"], "sword"),
    shield: pick(source.shield, ["none", "round", "tower"], "round"),
    cape: pick(source.cape, ["none", "red", "blue", "green"], "red"),
    mount: pick(source.mount, ["none", "horseBrown", "horseGrey"], "none"),
  };
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
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

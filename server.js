const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocket, WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const SAVE_FILE = path.join(DATA_DIR, "legacy-state.json");
const CHARACTER_CATALOG_FILE = path.join(ROOT, "assets", "generated-characters", "catalog.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const CHALLENGE_TTL_MS = 1000 * 60 * 5;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SOLANA_CHAIN_ID = process.env.SOLANA_CHAIN_ID || "mainnet";
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || `http://localhost:${PORT}`;
const SESSION_TOKEN_MAX = 160;
const TILE = 32;
const WORLD_W = 80;
const WORLD_H = 80;
const HAVEN_CENTER_X = 40;
const HAVEN_CENTER_Y = 42;
const HAVEN_SPAWN_X = 35;
const HAVEN_SPAWN_Y = 47;
const TICK_RATE = 60;
const BROADCAST_RATE = 20;
const DT = 1 / TICK_RATE;
const MAX_DEPTH = 100;
const COMBAT_WORLD_PREFIX = "combat";
const INVENTORY_SIZE = 10;
const EQUIPMENT_SLOTS = ["helmet", "chest", "gloves", "boots", "weapon"];
const RARITIES = [
  { id: "common", weight: 720, color: "#d8d2bd" },
  { id: "magic", weight: 210, color: "#5fa8ff" },
  { id: "rare", weight: 58, color: "#f2cf5b" },
  { id: "epic", weight: 11, color: "#b66dff" },
  { id: "legendary", weight: 1, color: "#ff8a2a" },
];
const ITEM_DEFS = [
  itemDef("helmet", "patched-cap", "Patched Cap"),
  itemDef("helmet", "rusted-sallet", "Rusted Sallet"),
  itemDef("helmet", "grave-crown", "Grave Crown"),
  itemDef("helmet", "ember-hood", "Ember Hood"),
  itemDef("chest", "travelers-vest", "Traveler's Vest"),
  itemDef("chest", "ringmail-vest", "Ringmail Vest"),
  itemDef("chest", "warden-coat", "Warden Coat"),
  itemDef("chest", "ashen-cuirass", "Ashen Cuirass"),
  itemDef("gloves", "linen-wraps", "Linen Wraps"),
  itemDef("gloves", "iron-grips", "Iron Grips"),
  itemDef("gloves", "grave-gauntlets", "Grave Gauntlets"),
  itemDef("gloves", "ember-claws", "Ember Claws"),
  itemDef("boots", "mud-boots", "Mud Boots"),
  itemDef("boots", "scout-boots", "Scout Boots"),
  itemDef("boots", "tomb-greaves", "Tomb Greaves"),
  itemDef("boots", "cinder-treads", "Cinder Treads"),
  itemDef("weapon", "chipped-sword", "Chipped Sword"),
  itemDef("weapon", "hunter-axe", "Hunter Axe"),
  itemDef("weapon", "grave-mace", "Grave Mace"),
  itemDef("weapon", "ember-blade", "Ember Blade"),
];
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
    portals: [{ x: HAVEN_CENTER_X * TILE, y: HAVEN_CENTER_Y * TILE, target: "combat", label: "Depth 1", spawnX: 40 * TILE, spawnY: 70 * TILE }],
  },
};
worlds.haven.portal = worlds.haven.portals[0];
const activeCombatWorlds = new Map();

const clients = new Map();
const challenges = new Map();
const sessions = new Map();
const rateLimits = new Map();
const server = http.createServer((req, res) => {
  if (req.url === "/api/legends") {
    sendJson(res, publicLegends());
    return;
  }

  if (req.method === "GET" && req.url === "/api/session") {
    const session = getRequestSession(req);
    if (!session && process.env.LEGACY_TEST_MODE === "1") {
      sendJson(res, {
        ok: true,
        profile: { wallet: "test", characterName: "Tester", needsName: false, renown: 0, records: { maxLevel: 1, longestLife: 0, mostKills: 0 } },
        turnstileSiteKey: "",
      });
      return;
    }
    sendJson(res, {
      ok: Boolean(session),
      profile: session ? publicProfile(session.profile) : null,
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || "",
    }, session ? 200 : 401);
    return;
  }

  if (req.method === "GET" && req.url === "/api/auth/config") {
    sendJson(res, { turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || "" });
    return;
  }

  if (req.method === "POST" && req.url === "/api/auth/challenge") {
    readJson(req, res, async (body) => {
      const ip = requestIp(req);
      if (!allowRate(`challenge:${ip}`, 10, 60_000)) {
        sendJson(res, { ok: false, error: "Too many attempts." }, 429);
        return;
      }
      const wallet = cleanWalletAddress(body.wallet);
      if (!wallet) {
        sendJson(res, { ok: false, error: "Invalid wallet address." }, 400);
        return;
      }
      const turnstileOk = await verifyTurnstile(body.turnstileToken, ip);
      if (!turnstileOk) {
        sendJson(res, { ok: false, error: "Bot verification failed." }, 403);
        return;
      }
      cleanupAuthMaps();
      const nonce = randomToken(18);
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
      const domain = hostFromOrigin(PUBLIC_ORIGIN) || req.headers.host || "localhost";
      const statement = "Sign in to Legacy. This does not trigger a transaction or cost gas.";
      const message = [
        `${domain} wants you to sign in with your Solana account:`,
        wallet,
        "",
        statement,
        `URI: ${PUBLIC_ORIGIN}`,
        "Version: 1",
        `Chain ID: ${SOLANA_CHAIN_ID}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
        `Expiration Time: ${expiresAt}`,
      ].join("\n");
      challenges.set(nonce, { wallet, message, expiresAt: Date.now() + CHALLENGE_TTL_MS, ip });
      sendJson(res, { ok: true, nonce, message });
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/auth/verify") {
    readJson(req, res, (body) => {
      const ip = requestIp(req);
      if (!allowRate(`verify:${ip}`, 15, 60_000)) {
        sendJson(res, { ok: false, error: "Too many attempts." }, 429);
        return;
      }
      const wallet = cleanWalletAddress(body.wallet);
      const nonce = String(body.nonce || "");
      const challenge = challenges.get(nonce);
      challenges.delete(nonce);
      if (!wallet || !challenge || challenge.wallet !== wallet || challenge.expiresAt < Date.now()) {
        sendJson(res, { ok: false, error: "Invalid or expired challenge." }, 401);
        return;
      }
      if (!verifySolanaSignature(wallet, challenge.message, body.signature)) {
        sendJson(res, { ok: false, error: "Invalid signature." }, 401);
        return;
      }
      const profile = getProfile(wallet);
      const token = createSession(wallet);
      sendJson(res, { ok: true, sessionToken: token, profile: publicProfile(profile) });
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/profile/name") {
    readJson(req, res, (body) => {
      const session = getBearerSession(req);
      if (!session) {
        sendJson(res, { ok: false, error: "Session expired." }, 401);
        return;
      }
      if (!allowRate(`name:${session.wallet}`, 8, 60_000)) {
        sendJson(res, { ok: false, error: "Too many attempts." }, 429);
        return;
      }
      const validation = validateCharacterName(body.name, session.wallet);
      if (!validation.ok) {
        sendJson(res, { ok: false, error: validation.error }, 400);
        return;
      }
      if (!session.profile.characterName) {
        session.profile.characterName = validation.name;
        session.profile.nameKey = normalizeName(validation.name);
        session.profile.appearance = randomAppearance();
        savePersisted();
      }
      sendJson(res, { ok: true, profile: publicProfile(session.profile) });
    });
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
      if (!player) {
        ws.send(JSON.stringify({ t: "authError", error: "Wallet session required." }));
        ws.close();
        return;
      }
      clients.set(player.id, player);
      ws.send(JSON.stringify({ t: "welcome", id: player.id, wallet: player.wallet, meta: player.meta }));
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

    if (msg.t === "respawn") {
      respawnPlayer(player);
      return;
    }

    if (msg.t === "equipItem") {
      equipInventoryItem(player, msg.itemId);
      return;
    }

    if (msg.t === "destroyItem") {
      destroyInventoryItem(player, msg.itemId);
      return;
    }

    if (process.env.LEGACY_TEST_MODE === "1" && msg.t === "testGiveItem") {
      if (player.inventory.length < INVENTORY_SIZE) player.inventory.push(makeItem(1));
      return;
    }

    if (process.env.LEGACY_TEST_MODE === "1" && msg.t === "testSpawnPrivateLoot") {
      const world = getWorld(player.world);
      if (world) world.loot.push(makeLoot(player.x, player.y, player.id, world.depth || 1));
      return;
    }

    if (process.env.LEGACY_TEST_MODE === "1" && msg.t === "testSpawnDamageLoot") {
      const world = getWorld(player.world);
      const ownerId = getLootOwner({ hitBy: player.id, damageBy: msg.damageBy || {} }) || player.id;
      if (world) world.loot.push(makeLoot(player.x, player.y, ownerId, world.depth || 1));
      return;
    }

    if (process.env.LEGACY_TEST_MODE === "1" && msg.t === "testKillPlayer") {
      killPlayer(player, "test");
    }
  });

  ws.on("close", () => {
    if (player) {
      const oldWorld = player.world;
      saveLiveState(player);
      clients.delete(player.id);
      cleanupEmptyCombatWorld(oldWorld);
      savePersisted();
    }
  });
});

setInterval(tick, 1000 / TICK_RATE);
setInterval(broadcastWorld, 1000 / BROADCAST_RATE);
setInterval(savePersisted, 5000);

server.listen(PORT, () => {
  console.log(`Legacy V1 running on http://localhost:${PORT}`);
});

function createPlayer(ws, msg) {
  const session = getSessionFromToken(msg.sessionToken);
  let profile = session?.profile || null;
  let wallet = session?.wallet || null;
  if (!profile && process.env.LEGACY_TEST_MODE === "1") {
    wallet = cleanId(msg.accountId) || `test-${cryptoId()}`;
    profile = getProfile(wallet);
    if (!profile.characterName) {
      profile.characterName = cleanName(msg.name, "Tester");
      profile.nameKey = normalizeName(profile.characterName);
      profile.appearance = randomAppearance();
    }
  }
  if (!profile || !profile.characterName) return null;
  const char = makeCharacter(profile);
  return {
    ws,
    id: cryptoId(),
    wallet,
    accountId: wallet,
    meta: profile,
    input: { dx: 0, dy: 0, attack: false, angle: 0 },
    attackCd: 0,
    portalCd: 1,
    sentWorld: null,
    dead: false,
    ...char,
  };
}

function makeCharacter(profile) {
  const saved = profile.lastLiveState && typeof profile.lastLiveState === "object" ? profile.lastLiveState : null;
  const base = {
    name: profile.characterName,
    house: "",
    world: "haven",
    x: HAVEN_SPAWN_X * TILE,
    y: HAVEN_SPAWN_Y * TILE,
    hp: 100,
    maxHp: 100,
    level: 1,
    xp: 0,
    gold: 0,
    kills: 0,
    power: 1 + Math.floor(profile.renown / 35),
    inventory: [],
    equipment: emptyEquipment(),
    appearance: cleanAppearance(profile.appearance || randomAppearance()),
    hitbox: { radius: PLAYER_HITBOX_RADIUS },
    facing: 1,
    moving: false,
    aliveSince: Date.now(),
  };
  if (!saved) {
    profile.generation += 1;
    return base;
  }
  const worldId = cleanWorldId(saved.world);
  const savedWorld = ensureWorldForTarget(worldId);
  const savedX = clamp(Number(saved.x) || base.x, TILE, WORLD_W * TILE - TILE);
  const savedY = clamp(Number(saved.y) || base.y, TILE, WORLD_H * TILE - TILE);
  const restoredPoint = getSafeRestorePoint(savedWorld, savedX, savedY);
  return {
    ...base,
    world: worldId,
    x: restoredPoint.x,
    y: restoredPoint.y,
    hp: clamp(Math.round(Number(saved.hp) || base.hp), 1, Number(saved.maxHp) || base.maxHp),
    maxHp: clamp(Math.round(Number(saved.maxHp) || base.maxHp), 1, 9999),
    level: clamp(Math.round(Number(saved.level) || base.level), 1, 999),
    xp: Math.max(0, Math.round(Number(saved.xp) || 0)),
    gold: Math.max(0, Math.round(Number(saved.gold) || 0)),
    kills: Math.max(0, Math.round(Number(saved.kills) || 0)),
    power: Math.max(base.power, Math.round(Number(saved.power) || base.power)),
    inventory: cleanSavedInventory(saved.inventory),
    equipment: cleanSavedEquipment(saved.equipment),
    appearance: cleanAppearance(saved.appearance || profile.appearance),
  };
}

function respawnPlayer(player) {
  const oldWorld = player.world;
  player.meta.lastLiveState = null;
  player.meta.appearance = randomAppearance();
  const next = makeCharacter(player.meta);
  Object.assign(player, next, {
    input: { dx: 0, dy: 0, attack: false, angle: 0 },
    attackCd: 0,
    portalCd: 1,
    dead: false,
  });
  cleanupEmptyCombatWorld(oldWorld);
  player.ws.send(JSON.stringify({ t: "revived", meta: player.meta }));
  savePersisted();
}

function tick() {
  for (const player of clients.values()) updatePlayer(player);
  cleanupEmptyCombatWorlds();
  updateEnemies();
  updateWorldEvent();
  updateCombatTexts();
}

function updatePlayer(player) {
  if (player.dead) return;
  const world = getWorld(player.world);
  if (!world) {
    movePlayerToWorld(player, "haven", HAVEN_SPAWN_X * TILE, HAVEN_SPAWN_Y * TILE);
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
    enemy.damageBy = enemy.damageBy || {};
    enemy.damageBy[player.id] = (enemy.damageBy[player.id] || 0) + dealt;
    addDamageText(world, enemy.x, enemy.y - 30, dealt);
    if (enemy.hp <= 0) dead.push(enemy);
  }

  for (const enemy of dead) {
    const index = world.enemies.indexOf(enemy);
    if (index === -1) continue;
    player.kills += 1;
    player.xp += enemy.level * 10;
    player.gold += 4 + enemy.level;
    const ownerId = getLootOwner(enemy) || player.id;
    if (rng() < getLootDropChance(world.depth)) world.loot.push(makeLoot(enemy.x, enemy.y, ownerId, world.depth));
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
    if (item.ownerId === player.id && distance(player, item) < 24 && player.inventory.length < INVENTORY_SIZE) {
      player.inventory.push(item.item);
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
  const spawn = getPortalSpawnPoint(targetWorld, portal, oldWorld);
  movePlayerToWorld(player, targetWorld.id, spawn.x, spawn.y);
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
    name: player.name,
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
  player.gold = 0;
  player.inventory = [];
  player.equipment = emptyEquipment();
  player.meta.lastLiveState = null;
  player.ws.send(JSON.stringify({ t: "death", grave, meta: player.meta }));
  savePersisted();
  cleanupEmptyCombatWorld(oldWorld);
}

function broadcastWorld() {
  for (const player of clients.values()) {
    if (player.ws.readyState !== WebSocket.OPEN) continue;
    const changedWorld = player.sentWorld !== player.world;
    const snapshot = snapshotWorld(player.world, changedWorld, player);
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

function snapshotWorld(worldId, includeTiles, viewer) {
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
      house: "",
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
    inventory: viewer ? viewer.inventory.map(publicItem) : [],
    equipment: viewer ? publicEquipment(viewer.equipment) : emptyEquipment(),
    inventorySize: INVENTORY_SIZE,
    equipmentSlots: EQUIPMENT_SLOTS,
    rarities: RARITIES.map((rarity) => ({ id: rarity.id, color: rarity.color })),
    loot: world.loot
      .filter((l) => viewer && l.ownerId === viewer.id)
      .map((l) => ({
        id: l.id,
        name: l.item.name,
        x: round2(l.x),
        y: round2(l.y),
        item: publicItem(l.item),
        rarity: l.item.rarity,
      })),
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

function getPortalSpawnPoint(targetWorld, sourcePortal, sourceWorldId = "") {
  const sourceDepth = depthFromWorldId(sourceWorldId);
  const targetDepth = depthFromWorldId(targetWorld?.id);
  let anchor = null;
  if (sourcePortal?.target === "haven") {
    return getSafePointNear(targetWorld, HAVEN_SPAWN_X * TILE, HAVEN_SPAWN_Y * TILE);
  } else if (sourceDepth && targetDepth && sourceDepth > targetDepth) {
    anchor = (targetWorld.portals || []).find((portal) => portal.kind === "next" || portal.target === sourceWorldId) || targetWorld.portal || null;
  } else if (sourcePortal) {
    return getSafePointNear(targetWorld, sourcePortal.spawnX ?? HAVEN_SPAWN_X * TILE, sourcePortal.spawnY ?? HAVEN_SPAWN_Y * TILE);
  }
  if (anchor) return getAdjacentPortalPoint(targetWorld, anchor);
  return getSafePointNear(targetWorld, HAVEN_SPAWN_X * TILE, HAVEN_SPAWN_Y * TILE);
}

function getSafeRestorePoint(world, x, y) {
  if (world && isWalkableAt(world, x, y, PLAYER_HITBOX_RADIUS)) return { x, y };
  const anchor = world?.portals?.[0] || world?.portal || null;
  if (anchor) return getAdjacentPortalPoint(world, anchor);
  return { x: HAVEN_SPAWN_X * TILE, y: HAVEN_SPAWN_Y * TILE };
}

function getAdjacentPortalPoint(world, portal) {
  const offsets = [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [0, 2],
    [2, 0],
    [-2, 0],
    [0, -2],
  ];
  for (const [dx, dy] of offsets) {
    const point = {
      x: portal.x + dx * TILE,
      y: portal.y + dy * TILE,
    };
    if (isWalkableAt(world, point.x, point.y, PLAYER_HITBOX_RADIUS) && tileAt(world, point.x, point.y) !== "portal") return point;
  }
  return getSafePointNear(world, portal.x, portal.y);
}

function getSafePointNear(world, x, y) {
  const px = clamp(Number(x) || HAVEN_SPAWN_X * TILE, TILE, WORLD_W * TILE - TILE);
  const py = clamp(Number(y) || HAVEN_SPAWN_Y * TILE, TILE, WORLD_H * TILE - TILE);
  if (world && isWalkableAt(world, px, py, PLAYER_HITBOX_RADIUS)) return { x: px, y: py };
  return randomPassablePointNear(world.id, px, py, TILE * 4, PLAYER_HITBOX_RADIUS);
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
      kind: "previous",
      label: depth === 1 ? "Back to haven" : `Back to depth ${depth - 1}`,
      spawnX: depth === 1 ? 40 * TILE : 40 * TILE,
      spawnY: depth === 1 ? 43 * TILE : 70 * TILE,
    },
  ];
  if (depth < MAX_DEPTH) {
    portals.push({ x: map.exitX * TILE, y: map.exitY * TILE, target: combatWorldId(depth + 1), kind: "next", label: `Depth ${depth + 1}`, spawnX: 40 * TILE, spawnY: 70 * TILE });
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
}

function getBiome(depth) {
  const tier = Math.floor((depth - 1) / 10);
  return BIOMES[(depth + tier - 1) % BIOMES.length];
}

function getEnemyCount(depth) {
  return clamp(24 + Math.floor(depth * 0.56), 24, 80);
}

function getRareLootChance(depth) {
  return clamp(0.03 + depth * 0.0008, 0.03, 0.12);
}

function getLootDropChance(depth) {
  return clamp(0.04 + depth * 0.0004, 0.04, 0.08);
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
    if (meta.generation > acc.oldestDynasty.generation) acc.oldestDynasty = { dynasty: meta.characterName || meta.dynasty || "-", generation: meta.generation };
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
    paintEllipse(HAVEN_CENTER_X, HAVEN_CENTER_Y, 28, 22, "grass");
    paintEllipse(HAVEN_CENTER_X, HAVEN_CENTER_Y, 17, 14, "grass");
    paintRoad(HAVEN_CENTER_X, HAVEN_CENTER_Y, 28, 42, "path", 1);
    paintRoad(HAVEN_CENTER_X, HAVEN_CENTER_Y, 52, 42, "path", 1);
    paintRoad(HAVEN_CENTER_X, HAVEN_CENTER_Y, 40, 30, "path", 1);
    paintRoad(HAVEN_CENTER_X, HAVEN_CENTER_Y, 40, 54, "path", 1);
    paintRoad(HAVEN_SPAWN_X, HAVEN_SPAWN_Y, HAVEN_CENTER_X, HAVEN_CENTER_Y, "path", 1);
    paintRect(32, 34, 17, 17, "village");
    paintRect(38, 40, 5, 5, "path");
    paintRect(25, 39, 7, 6, "village");
    paintRect(49, 39, 7, 6, "village");
    paintRect(36, 27, 9, 6, "village");
    paintRect(37, 51, 7, 6, "village");
    paintRect(HAVEN_CENTER_X, HAVEN_CENTER_Y, 1, 1, "portal");
    paintRect(27, 41, 2, 1, "building");
    paintRect(51, 41, 2, 1, "building");
    paintRect(39, 29, 2, 1, "building");
    paintRect(39, 53, 2, 1, "building");
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
    damageBy: {},
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

function makeLoot(x, y, ownerId, depth = 1) {
  const item = makeItem(depth);
  return {
    id: cryptoId(),
    ownerId,
    x,
    y,
    item,
  };
}

function makeItem(depth = 1) {
  const base = ITEM_DEFS[Math.floor(rng() * ITEM_DEFS.length)];
  const rarity = pickRarity(depth);
  return {
    uid: cryptoId(),
    id: base.id,
    name: rarityName(base.name, rarity),
    type: base.type,
    typeLabel: equipmentSlotLabel(base.type),
    rarity,
    icon: `assets/generated-items/${base.id}.png`,
  };
}

function itemDef(type, id, name) {
  return { type, id, name };
}

function pickRarity(depth) {
  const rareBoost = 1 + Math.min(depth, 100) / 100;
  const table = RARITIES.map((rarity) => ({
    ...rarity,
    weight: rarity.id === "common" || rarity.id === "magic" ? rarity.weight : rarity.weight * rareBoost,
  }));
  const total = table.reduce((sum, rarity) => sum + rarity.weight, 0);
  let roll = rng() * total;
  for (const rarity of table) {
    roll -= rarity.weight;
    if (roll <= 0) return rarity.id;
  }
  return "common";
}

function rarityName(name, rarity) {
  if (rarity === "common") return name;
  const prefix = {
    magic: "Glimmering",
    rare: "Gilded",
    epic: "Runebound",
    legendary: "Mythic",
  }[rarity] || "";
  return `${prefix} ${name}`;
}

function getLootOwner(enemy) {
  let ownerId = enemy.hitBy || null;
  let bestDamage = -1;
  for (const [playerId, damage] of Object.entries(enemy.damageBy || {})) {
    if (damage > bestDamage) {
      ownerId = playerId;
      bestDamage = damage;
    }
  }
  return ownerId;
}

function equipInventoryItem(player, itemId) {
  if (player.dead) return;
  const index = player.inventory.findIndex((item) => item.uid === itemId);
  if (index === -1) return;
  const item = player.inventory[index];
  if (!EQUIPMENT_SLOTS.includes(item.type)) return;
  const previous = player.equipment[item.type] || null;
  player.inventory.splice(index, 1);
  if (previous) {
    if (player.inventory.length >= INVENTORY_SIZE) {
      player.inventory.splice(index, 0, item);
      return;
    }
    player.inventory.push(previous);
  }
  player.equipment[item.type] = item;
}

function destroyInventoryItem(player, itemId) {
  if (player.dead) return;
  const index = player.inventory.findIndex((item) => item.uid === itemId);
  if (index !== -1) player.inventory.splice(index, 1);
}

function emptyEquipment() {
  return Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null]));
}

function publicEquipment(equipment) {
  const out = emptyEquipment();
  for (const slot of EQUIPMENT_SLOTS) out[slot] = equipment?.[slot] ? publicItem(equipment[slot]) : null;
  return out;
}

function publicItem(item) {
  if (!item) return null;
  return {
    uid: item.uid,
    id: item.id,
    name: item.name,
    type: item.type,
    typeLabel: item.typeLabel,
    rarity: item.rarity,
    icon: item.icon,
  };
}

function equipmentSlotLabel(slot) {
  return {
    helmet: "Casque",
    chest: "Torse",
    gloves: "Gants",
    boots: "Bottes",
    weapon: "Arme",
  }[slot] || slot;
}

function getProfile(wallet) {
  const key = cleanWalletAddress(wallet) || cleanId(wallet);
  if (!key) return null;
  if (!persisted.accounts[key]) {
    persisted.accounts[key] = {
      wallet: key,
      characterName: "",
      nameKey: "",
      appearance: randomAppearance(),
      lastLiveState: null,
      generation: 0,
      renown: 0,
      graves: [],
      relics: [],
      records: { maxLevel: 1, longestLife: 0, mostKills: 0 },
    };
  }
  const profile = persisted.accounts[key];
  profile.wallet = profile.wallet || key;
  profile.characterName = profile.characterName || "";
  profile.nameKey = profile.nameKey || normalizeName(profile.characterName);
  profile.appearance = cleanAppearance(profile.appearance || randomAppearance());
  profile.lastLiveState = profile.lastLiveState || null;
  profile.graves = Array.isArray(profile.graves) ? profile.graves : [];
  profile.relics = Array.isArray(profile.relics) ? profile.relics : [];
  profile.records = profile.records || { maxLevel: 1, longestLife: 0, mostKills: 0 };
  profile.generation = Number(profile.generation) || 0;
  profile.renown = Number(profile.renown) || 0;
  return profile;
}

function loadPersisted() {
  try {
    const state = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
    state.accounts ||= {};
    state.graves ||= [];
    state.relics ||= [];
    for (const [key, profile] of Object.entries(state.accounts)) {
      if (profile.dynasty && !profile.characterName) profile.characterName = cleanName(profile.dynasty, "");
      profile.nameKey = profile.nameKey || normalizeName(profile.characterName);
      profile.wallet = profile.wallet || key;
    }
    return state;
  } catch {
    return { accounts: {}, graves: [], relics: [] };
  }
}

function savePersisted() {
  for (const player of clients.values()) saveLiveState(player);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SAVE_FILE, JSON.stringify(persisted, null, 2));
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
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
  return tile === "wall" || tile === "forest" || tile === "water" || tile === "building";
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

function validateCharacterName(value, wallet) {
  const raw = String(value || "").normalize("NFKC").trim();
  if (raw.length < 3 || raw.length > 16) return { ok: false, error: "Name must be 3-16 characters." };
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*[A-Za-z0-9]$/.test(raw)) return { ok: false, error: "Name contains invalid characters." };
  if (/[_ -]{2,}/.test(raw)) return { ok: false, error: "Name has too many separators." };
  const key = normalizeName(raw);
  const reserved = new Set(["admin", "moderator", "system", "legacy", "server", "null", "undefined", "phantom", "solana"]);
  const banned = ["fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "retard", "pute", "merde", "salope", "connard", "encule"];
  if (reserved.has(key) || banned.some((word) => key.includes(word))) return { ok: false, error: "Name is not allowed." };
  for (const profile of Object.values(persisted.accounts)) {
    if (profile.wallet !== wallet && normalizeName(profile.characterName) === key) return { ok: false, error: "Name is already taken." };
  }
  return { ok: true, name: raw };
}

function normalizeName(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanId(value) {
  return String(value || "").replace(/[^\w-]/g, "").slice(0, 48);
}

function cleanWalletAddress(value) {
  const wallet = String(value || "").trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet) ? wallet : "";
}

function cleanWorldId(value) {
  const worldId = String(value || "");
  if (worldId === "haven") return "haven";
  return depthFromWorldId(worldId) ? worldId : "haven";
}

function cleanAppearance(value) {
  const source = value && typeof value === "object" ? value : {};
  const appearance = {};
  for (const slot of characterCatalog.renderOrder) {
    const slotDef = characterCatalog.slots[slot];
    const allowed = slotDef.items.map((item) => item.id);
    appearance[slot] = pick(source[slot], allowed, slotDef.default || (slot === "body" ? "human" : "none"));
  }
  return appearance;
}

function randomAppearance() {
  const appearance = {};
  for (const slot of characterCatalog.renderOrder) {
    const slotDef = characterCatalog.slots[slot];
    const choices = slotDef.items.map((item) => item.id).filter((id) => id !== "none");
    appearance[slot] = choices.length ? choices[Math.floor(rng() * choices.length)] : slotDef.default || "none";
  }
  return cleanAppearance(appearance);
}

function saveLiveState(player) {
  if (!player || player.dead || !player.meta) return;
  player.meta.lastLiveState = {
    world: cleanWorldId(player.world),
    x: round2(player.x),
    y: round2(player.y),
    hp: Math.max(1, Math.round(player.hp)),
    maxHp: player.maxHp,
    level: player.level,
    xp: player.xp,
    gold: player.gold,
    kills: player.kills,
    power: player.power,
    inventory: player.inventory.map(publicItem),
    equipment: publicEquipment(player.equipment),
    appearance: cleanAppearance(player.appearance),
    savedAt: new Date().toISOString(),
  };
}

function cleanSavedInventory(items) {
  return Array.isArray(items) ? items.map(cleanSavedItem).filter(Boolean).slice(0, INVENTORY_SIZE) : [];
}

function cleanSavedEquipment(equipment) {
  const out = emptyEquipment();
  for (const slot of EQUIPMENT_SLOTS) out[slot] = cleanSavedItem(equipment?.[slot]);
  return out;
}

function cleanSavedItem(item) {
  if (!item || !EQUIPMENT_SLOTS.includes(item.type)) return null;
  return {
    uid: cleanId(item.uid) || cryptoId(),
    id: cleanId(item.id) || "item",
    name: cleanName(item.name, "Item"),
    type: item.type,
    typeLabel: equipmentSlotLabel(item.type),
    rarity: RARITIES.some((rarity) => rarity.id === item.rarity) ? item.rarity : "common",
    icon: String(item.icon || "").startsWith("assets/generated-items/") ? item.icon : `assets/generated-items/${cleanId(item.id) || "equipment-icon"}.png`,
  };
}

function publicProfile(profile) {
  return {
    wallet: profile.wallet,
    characterName: profile.characterName || "",
    needsName: !profile.characterName,
    renown: profile.renown || 0,
    records: profile.records || { maxLevel: 1, longestLife: 0, mostKills: 0 },
  };
}

function createSession(wallet) {
  const token = randomToken(48);
  const profile = getProfile(wallet);
  sessions.set(token, { wallet, profile, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getRequestSession(req) {
  return getBearerSession(req);
}

function getBearerSession(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return getSessionFromToken(token);
}

function getSessionFromToken(token) {
  const clean = String(token || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, SESSION_TOKEN_MAX);
  const session = sessions.get(clean);
  if (!session || session.expiresAt < Date.now()) {
    if (clean) sessions.delete(clean);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function cleanupAuthMaps() {
  const now = Date.now();
  for (const [nonce, challenge] of challenges) if (challenge.expiresAt < now) challenges.delete(nonce);
  for (const [token, session] of sessions) if (session.expiresAt < now) sessions.delete(token);
}

function randomToken(length) {
  return crypto.randomBytes(Math.ceil(length * 0.75)).toString("base64url").slice(0, length);
}

function readJson(req, res, onBody) {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 16_384) req.destroy();
  });
  req.on("end", () => {
    try {
      onBody(raw ? JSON.parse(raw) : {});
    } catch {
      sendJson(res, { ok: false, error: "Invalid JSON." }, 400);
    }
  });
}

async function verifyTurnstile(token, ip) {
  if (process.env.LEGACY_TEST_MODE === "1" || !process.env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: String(token),
      remoteip: ip,
    });
    const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body });
    const result = await response.json();
    return Boolean(result.success);
  } catch {
    return false;
  }
}

function verifySolanaSignature(wallet, message, signature) {
  try {
    const publicKey = base58Decode(wallet);
    const sig = decodeSignature(signature);
    if (publicKey.length !== 32 || sig.length !== 64) return false;
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(String(message), "utf8"), key, sig);
  } catch {
    return false;
  }
}

function decodeSignature(signature) {
  if (Array.isArray(signature)) return Buffer.from(signature);
  const text = String(signature || "");
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) return base58Decode(text);
  return Buffer.from(text, "base64");
}

function base58Decode(value) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const text = String(value);
  let bytes = [0];
  let leadingZeros = 0;
  while (text[leadingZeros] === "1") leadingZeros += 1;
  if (leadingZeros === text.length) return Buffer.alloc(leadingZeros);
  for (const char of text.slice(leadingZeros)) {
    const carryStart = alphabet.indexOf(char);
    if (carryStart < 0) throw new Error("Invalid base58");
    let carry = carryStart;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = bytes.reverse();
  while (leadingZeros > 0) {
    out.unshift(0);
    leadingZeros -= 1;
  }
  return Buffer.from(out);
}

function allowRate(key, max, windowMs) {
  const now = Date.now();
  const entry = rateLimits.get(key) || { count: 0, resetAt: now + windowMs };
  if (entry.resetAt < now) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  rateLimits.set(key, entry);
  return entry.count <= max;
}

function requestIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
}

function hostFromOrigin(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function loadCharacterCatalog() {
  try {
    const catalog = JSON.parse(fs.readFileSync(CHARACTER_CATALOG_FILE, "utf8"));
    return {
      renderOrder: Array.isArray(catalog.renderOrder) ? catalog.renderOrder : ["body", "skin", "hair", "armor", "helmet", "weapon", "shield"],
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
      renderOrder: ["body", "skin", "hair", "armor", "helmet", "weapon", "shield"],
      slots: {
        body: { default: "human", items: [{ id: "human" }] },
        skin: { default: "pale", items: [{ id: "pale" }, { id: "tan" }, { id: "dark" }] },
        hair: { default: "short", items: [{ id: "none" }, { id: "short" }, { id: "long" }, { id: "wild" }] },
        armor: { default: "leather", items: [{ id: "none" }, { id: "leather" }, { id: "iron" }, { id: "dark" }] },
        helmet: { default: "none", items: [{ id: "none" }, { id: "ironCap" }, { id: "horned" }, { id: "hood" }] },
        weapon: { default: "sword", items: [{ id: "none" }, { id: "sword" }, { id: "axe" }, { id: "staff" }] },
        shield: { default: "round", items: [{ id: "none" }, { id: "round" }, { id: "tower" }] },
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

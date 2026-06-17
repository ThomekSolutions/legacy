const ui = {
  startScreen: document.querySelector("#startScreen"),
  deathScreen: document.querySelector("#deathScreen"),
  startButton: document.querySelector("#startButton"),
  newHeirButton: document.querySelector("#newHeirButton"),
  heroName: document.querySelector("#heroName"),
  houseName: document.querySelector("#houseName"),
  armorSelect: document.querySelector("#armorSelect"),
  helmetSelect: document.querySelector("#helmetSelect"),
  weaponSelect: document.querySelector("#weaponSelect"),
  shieldSelect: document.querySelector("#shieldSelect"),
  capeSelect: document.querySelector("#capeSelect"),
  mountSelect: document.querySelector("#mountSelect"),
  deathTitle: document.querySelector("#deathTitle"),
  deathSummary: document.querySelector("#deathSummary"),
  dynastyName: document.querySelector("#dynastyName"),
  level: document.querySelector("#levelStat"),
  hp: document.querySelector("#hpStat"),
  gold: document.querySelector("#goldStat"),
  renown: document.querySelector("#renownStat"),
  log: document.querySelector("#log"),
  legends: document.querySelector("#legends"),
  gameArea: document.querySelector(".game-area"),
  mobileControls: document.querySelector("#mobileControls"),
  moveStick: document.querySelector("#moveStick"),
  moveStickKnob: document.querySelector("#moveStickKnob"),
  mobileAttackButton: document.querySelector("#mobileAttackButton"),
};

const TILE = 32;
const WORLD_W = 80;
const WORLD_H = 80;
const ACCOUNT_KEY = "legacy.accountId.v1";
const SEND_RATE_MS = 16;
const WORLD_PIXEL_W = WORLD_W * TILE;
const WORLD_PIXEL_H = WORLD_H * TILE;
const CHARACTER_FRAME = 100;
const CHARACTER_SCALE = 1.18;
const DEFAULT_ATTACK_SPEC = {
  shape: "rectangle",
  range: 78,
  halfWidth: 18,
};
const CHARACTER_ANIMS = {
  idle: 6,
  walk: 8,
  attack: 6,
};
const CHARACTER_LAYERS = {
  body: ["human"],
  armor: ["leather", "iron", "dark"],
  helmet: ["ironCap", "horned", "hood"],
  weapon: ["sword", "axe", "staff"],
  shield: ["round", "tower"],
  cape: ["red", "blue", "green"],
  mount: ["horseBrown", "horseGrey"],
};

let ws = null;
let selfId = null;
let accountId = getAccountId();
let snapshot = null;
let worldTiles = null;
let meta = null;
let legends = null;
let statusText = "offline";
let hasStarted = false;
let lastInputSent = "";
let logs = [];
let gameScene = null;
const mobileInput = {
  enabled: false,
  movePointerId: null,
  attackPointerId: null,
  moveCenterX: 0,
  moveCenterY: 0,
  dx: 0,
  dy: 0,
  attack: false,
  aimClientX: null,
  aimClientY: null,
};

class LegacyScene extends Phaser.Scene {
  constructor() {
    super("LegacyScene");
    this.keys = null;
    this.entities = new Map();
    this.enemyEntities = new Map();
    this.lootEntities = new Map();
    this.damageTextEntities = new Map();
    this.tileObjects = [];
    this.wallObjects = [];
    this.propObjects = [];
    this.staticGraphics = null;
    this.worldMapImage = null;
    this.worldMapTextureKey = null;
    this.portalObjects = null;
    this.eventObjects = null;
    this.worldId = null;
    this.lastInputAt = 0;
    this.worldBuilt = false;
  }

  preload() {
    this.load.spritesheet("soldier-idle", "assets/characters/soldier-idle.png", { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet("soldier-walk", "assets/characters/soldier-walk.png", { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet("soldier-attack", "assets/characters/soldier-attack.png", { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet("orc-idle", "assets/characters/orc-idle.png", { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet("orc-walk", "assets/characters/orc-walk.png", { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet("orc-attack", "assets/characters/orc-attack.png", { frameWidth: 100, frameHeight: 100 });
    for (const [layer, variants] of Object.entries(CHARACTER_LAYERS)) {
      for (const variant of variants) {
        for (const anim of Object.keys(CHARACTER_ANIMS)) {
          this.load.spritesheet(characterSheetKey(layer, variant, anim), `assets/generated-characters/${layer}-${variant}-${anim}.png`, {
            frameWidth: CHARACTER_FRAME,
            frameHeight: CHARACTER_FRAME,
          });
        }
      }
    }
  }

  create() {
    gameScene = this;
    this.cameras.main.setBounds(0, 0, WORLD_PIXEL_W, WORLD_PIXEL_H);
    this.cameras.main.setBackgroundColor("#101312");
    this.input.mouse?.disableContextMenu();
    this.keys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      q: Phaser.Input.Keyboard.KeyCodes.Q,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      z: Phaser.Input.Keyboard.KeyCodes.Z,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
    });

    this.createTextures();
    this.createAnimations();
    this.scale.on("resize", this.resize, this);
    this.resize();
  }

  update(time) {
    if (!snapshot || !snapshot.tiles) {
      this.drawStatusOverlay();
      return;
    }
    this.statusText?.destroy();
    this.statusText = null;

    if (!this.worldBuilt || this.worldId !== snapshot.id) this.rebuildWorld();
    this.updatePortal();
    this.updateWorldEvent(time);
    this.updateLoot();
    this.updateEnemies();
    this.updatePlayers();
    this.updateDamageTexts();
    this.updateCamera();
    this.sendInput(time);
  }

  resize() {
    const parent = document.querySelector("#game");
    const rect = parent.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(240, Math.floor(rect.height));
    this.cameras.main.setSize(width, height);
  }

  createAnimations() {
    const defs = [
      ["soldier-idle", "soldier-idle", 0, 5, 6],
      ["soldier-walk", "soldier-walk", 0, 7, 10],
      ["soldier-attack", "soldier-attack", 0, 5, 12],
      ["orc-idle", "orc-idle", 0, 5, 6],
      ["orc-walk", "orc-walk", 0, 7, 10],
      ["orc-attack", "orc-attack", 0, 5, 12],
    ];
    for (const [key, texture, start, end, frameRate] of defs) {
      if (this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(texture, { start, end }),
        frameRate,
        repeat: -1,
      });
    }
    for (const [layer, variants] of Object.entries(CHARACTER_LAYERS)) {
      for (const variant of variants) {
        for (const [anim, frames] of Object.entries(CHARACTER_ANIMS)) {
          const key = characterAnimKey(layer, variant, anim);
          if (this.anims.exists(key)) continue;
          this.anims.create({
            key,
            frames: this.anims.generateFrameNumbers(characterSheetKey(layer, variant, anim), { start: 0, end: frames - 1 }),
            frameRate: anim === "walk" ? 10 : anim === "attack" ? 12 : 6,
            repeat: -1,
          });
        }
      }
    }
  }

  createTextures() {
    const textureDefs = {
      grass: ["#486b32", "#52773a", "#3f602e", "#77a34d"],
      path: ["#8a6a43", "#96764b", "#745739", "#b28d5d"],
      village: ["#555d58", "#68706b", "#3f4542", "#aab0a2"],
      ruin: ["#444949", "#585d5b", "#333837", "#a2a997"],
      grave: ["#343a32", "#42483d", "#2c312d", "#777564"],
      marsh: ["#315246", "#3e6252", "#243d38", "#6c8f69"],
    };
    for (const [name, colors] of Object.entries(textureDefs)) {
      for (let i = 0; i < 5; i += 1) this.makeTileTexture(`${name}-${i}`, name, colors, i);
    }
    for (let i = 0; i < 4; i += 1) this.makeWaterTexture(`water-${i}`, i);
    for (let i = 0; i < 2; i += 1) this.makeBridgeTexture(`bridge-${i}`, i);
    for (let i = 0; i < 2; i += 1) this.makePortalTexture(`portal-${i}`, i);
  }

  makeTileTexture(key, type, colors, seed) {
    if (this.textures.exists(key)) return;
    const gfx = this.make.graphics({ x: 0, y: 0, add: false });
    gfx.fillStyle(Phaser.Display.Color.HexStringToColor(colors[seed % 3]).color, 1);
    gfx.fillRect(0, 0, TILE, TILE);
    const speckles = type === "village" || type === "ruin" ? 14 : 28;
    for (let i = 0; i < speckles; i += 1) {
      const x = pseudo(seed + 1, i, 29);
      const y = pseudo(seed + 5, i, 29);
      const color = i % 4 === 0 ? colors[3] : colors[(seed + i) % 3];
      gfx.fillStyle(Phaser.Display.Color.HexStringToColor(color).color, i % 4 === 0 ? 0.18 : 0.32);
      gfx.fillRect(x, y, 2 + (i % 3), type === "village" || type === "ruin" ? 1 : 2);
    }
    if (type === "village" || type === "ruin") {
      gfx.lineStyle(1, 0x111413, 0.12);
      gfx.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
    }
    gfx.generateTexture(key, TILE, TILE);
    gfx.destroy();
  }

  makeWaterTexture(key, seed) {
    if (this.textures.exists(key)) return;
    const gfx = this.make.graphics({ x: 0, y: 0, add: false });
    gfx.fillStyle(seed % 2 ? 0x2a6574 : 0x245968, 1);
    gfx.fillRect(0, 0, TILE, TILE);
    gfx.fillStyle(0x81b8be, 0.32);
    gfx.fillRect(4, 8 + seed, 14, 2);
    gfx.fillRect(12, 20 - seed, 15, 2);
    gfx.fillStyle(0x000000, 0.16);
    gfx.fillRect(0, TILE - 4, TILE, 4);
    gfx.generateTexture(key, TILE, TILE);
    gfx.destroy();
  }

  makeBridgeTexture(key, seed) {
    if (this.textures.exists(key)) return;
    const gfx = this.make.graphics({ x: 0, y: 0, add: false });
    gfx.fillStyle(0x795537, 1);
    gfx.fillRect(0, 0, TILE, TILE);
    gfx.fillStyle(0x986b42, 1);
    for (let x = 1; x < TILE; x += 8) gfx.fillRect(x, 0, 5, TILE);
    gfx.fillStyle(0x000000, 0.3);
    gfx.fillRect(0, 7 + seed, TILE, 2);
    gfx.fillRect(0, 23 - seed, TILE, 2);
    gfx.generateTexture(key, TILE, TILE);
    gfx.destroy();
  }

  makePortalTexture(key, seed) {
    if (this.textures.exists(key)) return;
    const gfx = this.make.graphics({ x: 0, y: 0, add: false });
    gfx.fillStyle(0x322249, 1);
    gfx.fillRect(0, 0, TILE, TILE);
    gfx.lineStyle(2, 0x8d62c0, 1);
    gfx.strokeRect(6 + seed, 6, 20 - seed * 2, 20);
    gfx.lineStyle(2, 0xc7a5ff, 1);
    gfx.strokeRect(12, 12, 8, 8);
    gfx.generateTexture(key, TILE, TILE);
    gfx.destroy();
  }

  rebuildWorld() {
    this.worldId = snapshot.id;
    this.worldBuilt = true;
    this.clearObjects(this.tileObjects);
    this.clearObjects(this.wallObjects);
    this.clearObjects(this.propObjects);
    this.destroyDynamicEntities();
    this.staticGraphics?.destroy();
    this.worldMapImage?.destroy();
    this.destroyPortalObjects();
    if (this.worldMapTextureKey && this.textures.exists(this.worldMapTextureKey)) this.textures.remove(this.worldMapTextureKey);
    this.tileObjects = [];
    this.wallObjects = [];
    this.propObjects = [];
    this.staticGraphics = null;
    this.worldMapTextureKey = `world-map-${snapshot.id}-${Date.now()}`;
    const canvas = this.buildWorldCanvas();
    this.textures.addCanvas(this.worldMapTextureKey, canvas);
    this.worldMapImage = this.add.image(0, 0, this.worldMapTextureKey).setOrigin(0).setDepth(0);
  }

  buildWorldCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = WORLD_PIXEL_W;
    canvas.height = WORLD_PIXEL_H;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.fillStyle = snapshot.id?.startsWith("combat") ? "#0d0f10" : "#101712";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < WORLD_H; y += 1) {
      for (let x = 0; x < WORLD_W; x += 1) {
        const tile = snapshot.tiles[y]?.[x] || "grass";
        this.drawCanvasGround(context, tile, x, y);
      }
    }
    for (let y = 0; y < WORLD_H; y += 1) {
      for (let x = 0; x < WORLD_W; x += 1) {
        const tile = snapshot.tiles[y]?.[x] || "grass";
        if (!this.isSolidVisual(tile)) this.drawCanvasTerrainEdges(context, x, y);
        if (this.isSolidVisual(tile)) this.drawCanvasWall(context, tile, x, y);
        this.drawCanvasDecor(context, tile, x, y);
      }
    }
    return canvas;
  }

  drawCanvasGround(context, tile, x, y) {
    const key = this.groundTextureKey(tile, x, y);
    const source = this.getTextureSource(key);
    if (source) context.drawImage(source, x * TILE, y * TILE, TILE, TILE);
  }

  getTextureSource(key) {
    const texture = this.textures.get(key);
    return texture?.getSourceImage?.() || texture?.source?.[0]?.image || null;
  }

  drawCanvasTerrainEdges(context, x, y) {
    const px = x * TILE;
    const py = y * TILE;
    const top = getTile(x, y - 1);
    const right = getTile(x + 1, y);
    const bottom = getTile(x, y + 1);
    const left = getTile(x - 1, y);
    if (this.isSolidVisual(top)) this.canvasRect(context, px, py, TILE, 7, "#000000", 0.24);
    if (this.isSolidVisual(left)) this.canvasRect(context, px, py, 6, TILE, "#000000", 0.24);
    if (this.isSolidVisual(right)) this.canvasRect(context, px + TILE - 6, py, 6, TILE, "#000000", 0.24);
    if (this.isSolidVisual(bottom)) this.canvasRect(context, px, py + TILE - 5, TILE, 5, "#000000", 0.24);
    if (top === "water") this.canvasRect(context, px, py, TILE, 5, "#947c4a", 0.38);
    if (left === "water") this.canvasRect(context, px, py, 5, TILE, "#947c4a", 0.38);
    if (right === "water") this.canvasRect(context, px + TILE - 5, py, 5, TILE, "#947c4a", 0.38);
    if (bottom === "water") this.canvasRect(context, px, py + TILE - 5, TILE, 5, "#947c4a", 0.38);
  }

  drawCanvasWall(context, tile, x, y) {
    if (tile === "forest") {
      this.drawCanvasForest(context, x, y);
      return;
    }
    const px = x * TILE;
    const py = y * TILE;
    const top = getTile(x, y - 1);
    const right = getTile(x + 1, y);
    const bottom = getTile(x, y + 1);
    const left = getTile(x - 1, y);
    const exposed = !this.isSolidVisual(bottom);
    const edge = !this.isSolidVisual(top) || !this.isSolidVisual(right) || !this.isSolidVisual(left) || exposed;
    if (!edge) {
      this.canvasRect(context, px, py, TILE, TILE, variantFor(x, y, 3) === 0 ? "#282d2b" : "#303632", 1);
      return;
    }
    this.canvasRect(context, px, py, TILE, TILE, "#262a29", 1);
    this.canvasRect(context, px + 2, py + 2, TILE - 4, exposed ? 10 : 18, "#555a55", 1);
    this.canvasRect(context, px + 4, py + 3, TILE - 8, 2, "#6a716b", 1);
    this.canvasRect(context, px + 2, py + (exposed ? 12 : 20), TILE - 4, exposed ? 18 : 10, "#343837", 1);
    if (!this.isSolidVisual(left)) this.canvasRect(context, px, py + 4, 2, TILE - 6, "#bec6b8", 0.16);
    if (!this.isSolidVisual(right)) this.canvasRect(context, px + TILE - 3, py + 4, 3, TILE - 5, "#000000", 0.24);
    if (exposed) {
      this.canvasRect(context, px + 2, py + TILE - 4, TILE - 4, 4, "#000000", 0.42);
      this.canvasRect(context, px + 3, py + TILE, TILE - 6, 5, "#000000", 0.28);
    }
  }

  drawCanvasForest(context, x, y) {
    const px = x * TILE;
    const py = y * TILE;
    const edge = !this.isSolidVisual(getTile(x, y + 1)) || !this.isSolidVisual(getTile(x - 1, y)) || !this.isSolidVisual(getTile(x + 1, y));
    this.canvasRect(context, px, py, TILE, TILE, edge ? "#1f3a24" : "#15251b", 1);
    this.canvasRect(context, px + 2, py + 13, TILE - 4, 15, "#17301e", 1);
    this.canvasRect(context, px + 3, py + 6, 14, 12, "#2e5b34", 1);
    this.canvasRect(context, px + 12, py + 3, 13, 15, "#3c6d3a", 1);
    if (edge) {
      this.canvasRect(context, px + 14, py + 17, 5, 13, "#5b3923", 1);
      this.canvasRect(context, px + 2, py + 28, TILE - 4, 4, "#000000", 0.28);
    }
  }

  drawCanvasDecor(context, tile, x, y) {
    const px = x * TILE;
    const py = y * TILE;
    const v = Math.abs((x * 43 + y * 97) % 23);
    if (tile === "grass" && v === 0) {
      this.canvasRect(context, px + 8, py + 18, 4, 2, "#c7b94d", 1);
      this.canvasRect(context, px + 9, py + 20, 1, 4, "#6d8f43", 1);
    }
    if ((tile === "ruin" && v === 2) || tile === "rubble") {
      const variant = variantFor(x, y, 4);
      this.canvasRect(context, px + 6 + variant, py + 18, 7, 5, "#74746d", 1);
      this.canvasRect(context, px + 17, py + 10 + variant, 9, 6, "#74746d", 1);
      this.canvasRect(context, px + 8 + variant, py + 23, 8, 2, "#3d3f3d", 1);
    }
    if ((tile === "grave" && v === 3) || tile === "tomb") {
      const variant = variantFor(x, y, 3);
      this.canvasRect(context, px + 9, py + 19, 15, 5, "#000000", 0.35);
      this.canvasRect(context, px + 10 + variant, py + 9, 11, 15, "#8b8980", 1);
      this.canvasRect(context, px + 12 + variant, py + 12, 7, 2, "#65665f", 1);
    }
  }

  canvasRect(context, x, y, width, height, color, alpha) {
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
    context.restore();
  }

  clearObjects(objects) {
    for (const object of objects) object.destroy();
  }

  destroyDynamicEntities() {
    for (const collection of [this.entities, this.enemyEntities]) {
      for (const entity of collection.values()) this.destroyEntity(entity);
      collection.clear();
    }
    for (const loot of this.lootEntities.values()) loot.destroy();
    this.lootEntities.clear();
    for (const text of this.damageTextEntities.values()) text.destroy();
    this.damageTextEntities.clear();
  }

  addGroundTile(tile, x, y) {
    const key = this.groundTextureKey(tile, x, y);
    const image = this.add.image(x * TILE, y * TILE, key).setOrigin(0).setDepth(0);
    this.tileObjects.push(image);
  }

  groundTextureKey(tile, x, y) {
    const base = {
      wall: "ruin",
      forest: "grass",
      rubble: "ruin",
      tomb: "grave",
      portal: "portal",
    }[tile] || tile;
    const variants = base === "water" ? 4 : base === "bridge" || base === "portal" ? 2 : 5;
    return `${base}-${variantFor(x, y, variants)}`;
  }

  addTerrainEdges(tile, x, y) {
    const px = x * TILE;
    const py = y * TILE;
    const top = getTile(x, y - 1);
    const right = getTile(x + 1, y);
    const bottom = getTile(x, y + 1);
    const left = getTile(x - 1, y);
    if (this.isSolidVisual(top)) this.addRect(px, py, TILE, 7, 0x000000, 0.24, 1);
    if (this.isSolidVisual(left)) this.addRect(px, py, 6, TILE, 0x000000, 0.24, 1);
    if (this.isSolidVisual(right)) this.addRect(px + TILE - 6, py, 6, TILE, 0x000000, 0.24, 1);
    if (this.isSolidVisual(bottom)) this.addRect(px, py + TILE - 5, TILE, 5, 0x000000, 0.24, 1);
    if (top === "water") this.addRect(px, py, TILE, 5, 0x947c4a, 0.38, 1);
    if (left === "water") this.addRect(px, py, 5, TILE, 0x947c4a, 0.38, 1);
    if (right === "water") this.addRect(px + TILE - 5, py, 5, TILE, 0x947c4a, 0.38, 1);
    if (bottom === "water") this.addRect(px, py + TILE - 5, TILE, 5, 0x947c4a, 0.38, 1);
  }

  addWallTile(tile, x, y) {
    if (tile === "forest") {
      this.addForestTile(x, y);
      return;
    }
    const px = x * TILE;
    const py = y * TILE;
    const top = getTile(x, y - 1);
    const right = getTile(x + 1, y);
    const bottom = getTile(x, y + 1);
    const left = getTile(x - 1, y);
    const exposed = !this.isSolidVisual(bottom);
    const edge = !this.isSolidVisual(top) || !this.isSolidVisual(right) || !this.isSolidVisual(left) || exposed;

    if (!edge) {
      this.addRect(px, py, TILE, TILE, variantFor(x, y, 3) === 0 ? 0x282d2b : 0x303632, 1, 2);
      return;
    }

    this.addRect(px, py, TILE, TILE, 0x262a29, 1, 3);
    this.addRect(px + 2, py + 2, TILE - 4, exposed ? 10 : 18, 0x555a55, 1, 3);
    this.addRect(px + 4, py + 3, TILE - 8, 2, 0x6a716b, 1, 3);
    this.addRect(px + 2, py + (exposed ? 12 : 20), TILE - 4, exposed ? 18 : 10, 0x343837, 1, 3);
    if (!this.isSolidVisual(left)) this.addRect(px, py + 4, 2, TILE - 6, 0xbec6b8, 0.16, 4);
    if (!this.isSolidVisual(right)) this.addRect(px + TILE - 3, py + 4, 3, TILE - 5, 0x000000, 0.24, 4);
    if (exposed) {
      this.addRect(px + 2, py + TILE - 4, TILE - 4, 4, 0x000000, 0.42, 4);
      this.addRect(px + 3, py + TILE, TILE - 6, 5, 0x000000, 0.28, 4);
    }
  }

  addForestTile(x, y) {
    const px = x * TILE;
    const py = y * TILE;
    const edge = !this.isSolidVisual(getTile(x, y + 1)) || !this.isSolidVisual(getTile(x - 1, y)) || !this.isSolidVisual(getTile(x + 1, y));
    this.addRect(px, py, TILE, TILE, edge ? 0x1f3a24 : 0x15251b, 1, 2);
    this.addRect(px + 2, py + 13, TILE - 4, 15, 0x17301e, 1, 3);
    this.addRect(px + 3, py + 6, 14, 12, 0x2e5b34, 1, 3);
    this.addRect(px + 12, py + 3, 13, 15, 0x3c6d3a, 1, 3);
    if (edge) {
      this.addRect(px + 14, py + 17, 5, 13, 0x5b3923, 1, 4);
      this.addRect(px + 2, py + 28, TILE - 4, 4, 0x000000, 0.28, 4);
    }
  }

  addDecor(tile, x, y) {
    const px = x * TILE;
    const py = y * TILE;
    const v = Math.abs((x * 43 + y * 97) % 23);
    if (tile === "grass" && v === 0) {
      this.addRect(px + 8, py + 18, 4, 2, 0xc7b94d, 1, 5);
      this.addRect(px + 9, py + 20, 1, 4, 0x6d8f43, 1, 5);
    }
    if ((tile === "ruin" && v === 2) || tile === "rubble") this.addRubble(px, py, x, y);
    if ((tile === "grave" && v === 3) || tile === "tomb") this.addTomb(px, py, x, y);
  }

  addRubble(px, py, x, y) {
    const variant = variantFor(x, y, 4);
    this.addRect(px + 6 + variant, py + 18, 7, 5, 0x74746d, 1, 5);
    this.addRect(px + 17, py + 10 + variant, 9, 6, 0x74746d, 1, 5);
    this.addRect(px + 8 + variant, py + 23, 8, 2, 0x3d3f3d, 1, 5);
  }

  addTomb(px, py, x, y) {
    const variant = variantFor(x, y, 3);
    this.addRect(px + 9, py + 19, 15, 5, 0x000000, 0.35, 5);
    this.addRect(px + 10 + variant, py + 9, 11, 15, 0x8b8980, 1, 5);
    this.addRect(px + 12 + variant, py + 12, 7, 2, 0x65665f, 1, 5);
  }

  addRect(x, y, width, height, color, alpha, depth) {
    if (!this.staticGraphics) {
      const rect = this.add.rectangle(x, y, width, height, color, alpha).setOrigin(0).setDepth(depth);
      this.propObjects.push(rect);
      return rect;
    }
    this.staticGraphics.fillStyle(color, alpha);
    this.staticGraphics.fillRect(x, y, width, height);
    return this.staticGraphics;
  }

  updatePortal() {
    const portals = snapshot.portals || (snapshot.portal ? [snapshot.portal] : []);
    if (!portals.length) {
      this.destroyPortalObjects();
      return;
    }
    if (!this.portalObjects) this.portalObjects = new Map();
    const seen = new Set();
    portals.forEach((portal, index) => {
      const key = `${portal.x}-${portal.y}-${index}`;
      seen.add(key);
      const tileX = Math.floor(portal.x / TILE) * TILE;
      const tileY = Math.floor(portal.y / TILE) * TILE;
      let object = this.portalObjects.get(key);
      if (!object) {
        object = {
          tile: this.add.rectangle(tileX, tileY, TILE, TILE).setOrigin(0).setStrokeStyle(2, 0xc7a5ff, 0.95).setDepth(8),
          text: this.add.text(tileX + TILE / 2, tileY - 8, portal.label, { fontFamily: "system-ui", fontSize: "12px", color: "#ece7dc" }).setOrigin(0.5, 1).setDepth(20),
        };
        this.portalObjects.set(key, object);
      }
      const color = portal.target === "haven" ? 0xc7a5ff : portal.target?.startsWith("combat") ? 0xd0ba77 : 0x8fbdd9;
      object.tile.setPosition(tileX, tileY).setStrokeStyle(2, color, 0.95);
      object.text.setPosition(tileX + TILE / 2, tileY - 8).setText(portal.label);
    });
    for (const [key, object] of this.portalObjects.entries()) {
      if (seen.has(key)) continue;
      object.tile.destroy();
      object.text.destroy();
      this.portalObjects.delete(key);
    }
  }

  destroyPortalObjects() {
    if (!this.portalObjects) return;
    for (const object of this.portalObjects.values()) {
      object.tile.destroy();
      object.text.destroy();
    }
    this.portalObjects.clear();
    this.portalObjects = null;
  }

  updateWorldEvent(time) {
    const event = snapshot.event;
    if (!event) {
      if (this.eventObjects) {
        Object.values(this.eventObjects).forEach((object) => object.destroy());
        this.eventObjects = null;
      }
      return;
    }
    if (!this.eventObjects) {
      this.eventObjects = {
        ring: this.add.circle(event.x, event.y, 24).setStrokeStyle(4, 0x8f69bd, 1).setDepth(7),
        core: this.add.rectangle(event.x, event.y, 24, 24, 0x211922, 1).setDepth(7),
      };
    }
    const pulse = 24 + Math.sin(time / 170) * 8;
    this.eventObjects.ring.setPosition(event.x, event.y).setRadius(pulse).setStrokeStyle(4, event.spawned ? 0xd9784f : 0x8f69bd, 1);
    this.eventObjects.core.setPosition(event.x, event.y);
  }

  updatePlayers() {
    const seen = new Set();
    for (const player of snapshot.players) {
      seen.add(player.id);
      const entity = this.ensureCharacter(this.entities, player.id, true);
      this.updateCharacterEntity(entity, player, player.id === selfId);
    }
    this.destroyMissing(this.entities, seen);
  }

  updateEnemies() {
    const seen = new Set();
    for (const enemy of snapshot.enemies) {
      seen.add(enemy.id);
      const entity = this.ensureCharacter(this.enemyEntities, enemy.id, false);
      this.updateCharacterEntity(entity, enemy, false);
    }
    this.destroyMissing(this.enemyEntities, seen);
  }

  ensureCharacter(collection, id, player) {
    let entity = collection.get(id);
    if (entity) return entity;
    const sprite = this.add.sprite(0, 0, player ? "px-body-human-idle" : "orc-idle").setDepth(player ? 14 : 12).setScale(player ? CHARACTER_SCALE : 1.68);
    const layers = player ? this.createPaperDollLayers() : null;
    const attackZone = player ? this.add.graphics().setDepth(13).setVisible(false) : null;
    const name = this.add.text(0, -62, "", { fontFamily: "system-ui", fontSize: "12px", color: "#f0d27b" }).setOrigin(0.5).setDepth(20);
    const barBg = this.add.rectangle(0, -52, 38, 4, 0x171111, 1).setDepth(20);
    const bar = this.add.rectangle(-19, -52, 38, 4, 0xc35b5b, 1).setOrigin(0, 0.5).setDepth(20);
    entity = { sprite, layers, attackZone, name, barBg, bar, x: 0, y: 0, initialized: false, player };
    collection.set(id, entity);
    return entity;
  }

  createPaperDollLayers() {
    const makeLayer = (depth) => this.add.sprite(0, 0, "px-body-human-idle").setDepth(depth).setScale(CHARACTER_SCALE).setVisible(false);
    return {
      mount: makeLayer(9),
      cape: makeLayer(11),
      armor: makeLayer(15),
      helmet: makeLayer(16),
      weapon: makeLayer(17),
      shield: makeLayer(18),
    };
  }

  updateCharacterEntity(entity, source, self) {
    if (!entity.initialized) {
      entity.x = source.x;
      entity.y = source.y;
      entity.initialized = true;
    }
    const lerp = self ? 0.92 : 0.45;
    entity.x += (source.x - entity.x) * lerp;
    entity.y += (source.y - entity.y) * lerp;
    const appearance = normalizeAppearance(source.appearance);
    const mounted = entity.player && appearance.mount !== "none";
    const visualY = entity.y;
    const action = source.attackCd > 0.12 ? "attack" : source.moving ? "walk" : "idle";
    const texturePrefix = entity.player ? "soldier" : "orc";
    const anim = entity.player ? characterAnimKey("body", "human", action) : `${texturePrefix}-${action}`;
    entity.sprite.setPosition(entity.x, visualY).setFlipX(source.facing < 0).play(anim, true);
    if (entity.player) {
      this.updateAttackZone(entity, source, self);
      this.updatePaperDollLayers(entity, appearance, source, visualY, action);
    }
    entity.name.setPosition(entity.x, entity.y - (mounted ? 64 : 48)).setText(entity.player ? (self ? "You" : `${source.name} ${source.house}`) : "");
    entity.name.setColor(self ? "#f0d27b" : "#c8d7f0");
    entity.barBg.setPosition(entity.x, entity.y - (mounted ? 54 : 38));
    entity.bar.setPosition(entity.x - 19, entity.y - (mounted ? 54 : 38)).setSize(38 * Phaser.Math.Clamp(source.hp / source.maxHp, 0, 1), 4);
  }

  updateAttackZone(entity, source, self) {
    const graphics = entity.attackZone;
    if (!graphics) return;
    graphics.clear();
    if (source.attackCd <= 0.02) {
      graphics.setVisible(false);
      return;
    }

    const spec = normalizeAttackSpec(source.attackSpec);
    const angle = Number.isFinite(source.attackAngle) ? source.attackAngle : 0;
    const alpha = self ? 0.32 : 0.18;
    graphics.setVisible(true);

    if (spec.shape === "rectangle") {
      drawAttackRectangle(graphics, entity.x, entity.y, angle, spec.range, spec.halfWidth, alpha);
    }
  }

  updatePaperDollLayers(entity, appearance, source, visualY, action) {
    const layers = entity.layers;
    this.updatePixelLayer(layers.mount, "mount", appearance.mount, action, entity.x, visualY, source.facing);
    this.updatePixelLayer(layers.cape, "cape", appearance.cape, action, entity.x, visualY, source.facing);
    this.updatePixelLayer(layers.armor, "armor", appearance.armor, action, entity.x, visualY, source.facing);
    this.updatePixelLayer(layers.helmet, "helmet", appearance.helmet, action, entity.x, visualY, source.facing);
    this.updatePixelLayer(layers.weapon, "weapon", appearance.weapon, action, entity.x, visualY, source.facing);
    this.updatePixelLayer(layers.shield, "shield", appearance.shield, action, entity.x, visualY, source.facing);
  }

  updatePixelLayer(sprite, layer, variant, action, x, y, facing) {
    if (!variant || variant === "none") {
      sprite.setVisible(false);
      return;
    }
    sprite
      .setVisible(true)
      .setPosition(x, y)
      .setFlipX(facing < 0)
      .play(characterAnimKey(layer, variant, action), true);
  }

  updateLoot() {
    const seen = new Set();
    for (const item of snapshot.loot) {
      seen.add(item.id);
      let loot = this.lootEntities.get(item.id);
      if (!loot) {
        loot = this.add.rectangle(item.x, item.y, 10, 10, item.rare ? 0xd6b24d : 0xb4c27d, 1).setDepth(9);
        this.lootEntities.set(item.id, loot);
      }
      loot.setPosition(item.x, item.y);
    }
    for (const [id, loot] of this.lootEntities.entries()) {
      if (!seen.has(id)) {
        loot.destroy();
        this.lootEntities.delete(id);
      }
    }
  }

  updateDamageTexts() {
    const seen = new Set();
    for (const item of snapshot.combatTexts ?? []) {
      seen.add(item.id);
      let text = this.damageTextEntities.get(item.id);
      if (!text) {
        text = this.add.text(item.x, item.y, String(item.value), {
          fontFamily: "system-ui",
          fontSize: "16px",
          fontStyle: "800",
          color: "#f8e38a",
          stroke: "#32170d",
          strokeThickness: 4,
        }).setOrigin(0.5).setDepth(60);
        this.damageTextEntities.set(item.id, text);
      }

      const life = Math.max(1, item.life || 850);
      const progress = Phaser.Math.Clamp((item.age || 0) / life, 0, 1);
      const jump = Math.sin(progress * Math.PI) * 15;
      const rise = progress * 34;
      const drift = Math.sin(progress * Math.PI * 2) * 4;
      text
        .setText(String(item.value))
        .setPosition(item.x + drift, item.y - rise - jump)
        .setAlpha(1 - progress)
        .setScale(1 + Math.sin(progress * Math.PI) * 0.28);
    }
    for (const [id, text] of this.damageTextEntities.entries()) {
      if (seen.has(id)) continue;
      text.destroy();
      this.damageTextEntities.delete(id);
    }
  }

  destroyMissing(collection, seen) {
    for (const [id, entity] of collection.entries()) {
      if (seen.has(id)) continue;
      this.destroyEntity(entity);
      collection.delete(id);
    }
  }

  destroyEntity(entity) {
    entity.sprite.destroy();
    entity.attackZone?.destroy();
    entity.name.destroy();
    entity.barBg.destroy();
    entity.bar.destroy();
    if (entity.layers) {
      for (const layer of Object.values(entity.layers)) layer.destroy();
    }
  }

  updateCamera() {
    const self = getSelf();
    if (!self) return;
    const selfEntity = this.entities.get(selfId);
    const x = selfEntity?.x ?? self.x;
    const y = selfEntity?.y ?? self.y;
    this.cameras.main.centerOn(x, y);
    this.cameras.main.scrollX = Phaser.Math.Clamp(this.cameras.main.scrollX, 0, WORLD_PIXEL_W - this.scale.width);
    this.cameras.main.scrollY = Phaser.Math.Clamp(this.cameras.main.scrollY, 0, WORLD_PIXEL_H - this.scale.height);
  }

  sendInput(time) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !snapshot || time - this.lastInputAt < SEND_RATE_MS) return;
    const self = getSelf();
    if (!self) return;
    this.lastInputAt = time;
    const keyboardDx = Number(this.keys.left.isDown || this.keys.a.isDown || this.keys.q.isDown) * -1 + Number(this.keys.right.isDown || this.keys.d.isDown);
    const keyboardDy = Number(this.keys.up.isDown || this.keys.w.isDown || this.keys.z.isDown) * -1 + Number(this.keys.down.isDown || this.keys.s.isDown);
    const pointer = this.input.activePointer;
    const mobileAimPoint = getMobileAimWorldPoint(this);
    const worldPoint = mobileAimPoint || this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const dx = keyboardDx || mobileInput.dx;
    const dy = keyboardDy || mobileInput.dy;
    const input = {
      t: "input",
      dx,
      dy,
      attack: mobileInput.attack || (!mobileInput.enabled && pointer.isDown) || this.keys.space.isDown,
      angle: Math.atan2(worldPoint.y - self.y, worldPoint.x - self.x),
    };
    const payload = JSON.stringify(input);
    if (payload === lastInputSent) return;
    lastInputSent = payload;
    ws.send(payload);
  }

  isSolidVisual(tile) {
    return tile === "wall" || tile === "forest";
  }

  drawStatusOverlay() {
    if (!hasStarted || this.statusText) return;
    this.statusText = this.add.text(30, 40, statusText === "online" ? "Waiting for the world..." : "Server offline", {
      fontFamily: "system-ui",
      fontSize: "16px",
      color: "#d4c497",
    }).setScrollFactor(0).setDepth(100);
  }
}

const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: 960,
  height: 640,
  backgroundColor: "#101312",
  pixelArt: true,
  roundPixels: false,
  render: {
    antialias: false,
    pixelArt: true,
    mipmapRegeneration: false,
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: "game",
    width: "100%",
    height: "100%",
  },
  scene: [LegacyScene],
};

const game = new Phaser.Game(config);

function connect(name, house, appearance) {
  statusText = "connecting";
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.addEventListener("open", () => {
    statusText = "online";
    ws.send(JSON.stringify({ t: "hello", accountId, name, house, appearance }));
    pushLog("Connected to the Legacy server.");
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.t === "welcome") {
      selfId = msg.id;
      accountId = msg.account;
      meta = msg.meta;
      localStorage.setItem(ACCOUNT_KEY, accountId);
      return;
    }

    if (msg.t === "state") {
      selfId = msg.selfId;
      if (msg.snapshot.tiles) {
        worldTiles = msg.snapshot.tiles;
        if (gameScene) gameScene.worldBuilt = false;
      }
      snapshot = { ...msg.snapshot, tiles: worldTiles };
      meta = msg.meta;
      legends = msg.legends;
      updateSidebar();
      return;
    }

    if (msg.t === "death") {
      meta = msg.meta;
      ui.deathTitle.textContent = `${msg.grave.name} has died.`;
      ui.deathSummary.textContent = `Level ${msg.grave.level}, ${msg.grave.kills} kills, survived ${msg.grave.lifeSeconds}s. Cause: ${msg.grave.cause}.`;
      ui.deathScreen.classList.remove("hidden");
      pushLog("A new grave has been written into the server history.");
      updateSidebar();
      return;
    }

    if (msg.t === "revived") {
      meta = msg.meta;
      ui.deathScreen.classList.add("hidden");
      pushLog("An heir takes up the road.");
    }
  });

  ws.addEventListener("close", () => {
    statusText = "offline";
    pushLog("Connection lost. Reload the page or restart the server.");
  });
}

function getSelf() {
  return snapshot?.players.find((player) => player.id === selfId) || null;
}

function getTile(x, y) {
  if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return "wall";
  return snapshot?.tiles?.[y]?.[x] || "wall";
}

function getAccountId() {
  let id = localStorage.getItem(ACCOUNT_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(ACCOUNT_KEY, id);
  }
  return id;
}

function updateSidebar() {
  const self = getSelf();
  ui.dynastyName.textContent = meta?.dynasty ? `House ${meta.dynasty} Gen. ${meta.generation}` : "-";
  ui.level.textContent = self?.level ?? meta?.records?.maxLevel ?? 1;
  ui.hp.textContent = self ? `${self.hp}/${self.maxHp}` : "-";
  ui.gold.textContent = self?.gold ?? 0;
  ui.renown.textContent = meta?.renown ?? 0;
  ui.log.innerHTML = logs.map((entry) => `<li>${entry}</li>`).join("");

  const records = legends?.records;
  const cards = [];
  if (records) {
    cards.push(`<div class="legend-card">Server: lvl. ${records.maxLevel}, ${records.mostKills} kills, ${records.longestLife}s</div>`);
    cards.push(`<div class="legend-card">Oldest dynasty: ${records.oldestDynasty.dynasty} Gen. ${records.oldestDynasty.generation}</div>`);
  }
  for (const grave of legends?.graves ?? []) {
    cards.push(`<div class="legend-card">${grave.name}, lvl. ${grave.level}<br>Death: ${grave.cause}, ${grave.lifeSeconds}s</div>`);
  }
  for (const relic of legends?.relics ?? []) {
    cards.push(`<div class="legend-card">${relic.name}<br>${relic.kills} kills</div>`);
  }
  ui.legends.innerHTML = cards.join("");
}

function pushLog(text) {
  logs.unshift(text);
  logs = logs.slice(0, 8);
  updateSidebar();
}

function variantFor(x, y, count) {
  return Math.abs((x * 928371 + y * 689287) % count);
}

function pseudo(seed, i, max) {
  const value = Math.sin((seed * 91.7 + i * 47.3) * 999) * 10000;
  return Math.floor((value - Math.floor(value)) * max);
}

function characterSheetKey(layer, variant, anim) {
  return `px-${layer}-${variant}-${anim}`;
}

function characterAnimKey(layer, variant, anim) {
  return `${characterSheetKey(layer, variant, anim)}-anim`;
}

function normalizeAttackSpec(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    shape: source.shape === "rectangle" ? source.shape : DEFAULT_ATTACK_SPEC.shape,
    range: Number.isFinite(source.range) ? source.range : DEFAULT_ATTACK_SPEC.range,
    halfWidth: Number.isFinite(source.halfWidth) ? source.halfWidth : DEFAULT_ATTACK_SPEC.halfWidth,
  };
}

function drawAttackRectangle(graphics, x, y, angle, range, halfWidth, alpha) {
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const px = -ay;
  const py = ax;
  const startLeft = { x: x + px * halfWidth, y: y + py * halfWidth };
  const startRight = { x: x - px * halfWidth, y: y - py * halfWidth };
  const endRight = { x: x + ax * range - px * halfWidth, y: y + ay * range - py * halfWidth };
  const endLeft = { x: x + ax * range + px * halfWidth, y: y + ay * range + py * halfWidth };

  graphics.fillStyle(0xf1c75b, alpha);
  graphics.lineStyle(2, 0xf8df88, 0.92);
  graphics.beginPath();
  graphics.moveTo(startLeft.x, startLeft.y);
  graphics.lineTo(endLeft.x, endLeft.y);
  graphics.lineTo(endRight.x, endRight.y);
  graphics.lineTo(startRight.x, startRight.y);
  graphics.closePath();
  graphics.fillPath();
  graphics.strokePath();

  graphics.lineStyle(1, 0xfff0ad, 0.7);
  graphics.beginPath();
  graphics.moveTo(x, y);
  graphics.lineTo(x + ax * range, y + ay * range);
  graphics.strokePath();
}

function normalizeAppearance(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    body: source.body || "soldier",
    armor: source.armor || "leather",
    helmet: source.helmet || "ironCap",
    weapon: source.weapon || "sword",
    shield: source.shield || "round",
    cape: source.cape || "red",
    mount: source.mount || "none",
  };
}

function getAppearanceColors(appearance) {
  const armor = {
    none: 0x000000,
    leather: 0x8b5c34,
    iron: 0xb8bbb5,
    dark: 0x303437,
  };
  const helmet = {
    none: 0x000000,
    ironCap: 0xb8bbb5,
    horned: 0x8f8d83,
    hood: 0x323a34,
  };
  const weapon = {
    none: 0x000000,
    sword: 0xc9c7bb,
    axe: 0xb8bbb5,
    staff: 0x8d6136,
  };
  const shield = {
    none: 0x000000,
    round: 0x8c5f33,
    tower: 0x7f8580,
  };
  const cape = {
    none: 0x000000,
    red: 0x9d2f35,
    blue: 0x365d96,
    green: 0x476d3c,
  };
  const mount = {
    none: 0x000000,
    horseBrown: 0x6b4b2e,
    horseGrey: 0x8a8b83,
  };
  return {
    armor: armor[appearance.armor] ?? armor.leather,
    helmet: helmet[appearance.helmet] ?? helmet.ironCap,
    weapon: weapon[appearance.weapon] ?? weapon.sword,
    shield: shield[appearance.shield] ?? shield.round,
    cape: cape[appearance.cape] ?? cape.red,
    mount: mount[appearance.mount] ?? mount.none,
  };
}

function getSelectedAppearance() {
  return {
    body: "soldier",
    armor: ui.armorSelect?.value || "leather",
    helmet: ui.helmetSelect?.value || "ironCap",
    weapon: ui.weaponSelect?.value || "sword",
    shield: ui.shieldSelect?.value || "round",
    cape: ui.capeSelect?.value || "red",
    mount: ui.mountSelect?.value || "none",
  };
}

function setupMobileControls() {
  if (!ui.gameArea || !ui.moveStick || !ui.moveStickKnob || !ui.mobileAttackButton) return;

  const startMove = (event) => {
    refreshMobileMode();
    if (!mobileInput.enabled || mobileInput.movePointerId !== null || isOverlayOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    mobileInput.movePointerId = event.pointerId;
    const rect = ui.moveStick.getBoundingClientRect();
    mobileInput.moveCenterX = rect.left + rect.width / 2;
    mobileInput.moveCenterY = rect.top + rect.height / 2;
    ui.moveStick.classList.add("is-active");
    ui.moveStick.setPointerCapture?.(event.pointerId);
    updateMove(event);
  };

  const updateMove = (event) => {
    if (event.pointerId !== mobileInput.movePointerId) return;
    event.preventDefault();
    const rect = ui.moveStick.getBoundingClientRect();
    const max = Math.max(24, Math.min(rect.width, rect.height) * 0.34);
    const rawX = event.clientX - mobileInput.moveCenterX;
    const rawY = event.clientY - mobileInput.moveCenterY;
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > max ? max / distance : 1;
    const knobX = rawX * scale;
    const knobY = rawY * scale;
    const deadZone = 0.16;
    mobileInput.dx = Math.abs(knobX / max) > deadZone ? knobX / max : 0;
    mobileInput.dy = Math.abs(knobY / max) > deadZone ? knobY / max : 0;
    ui.moveStickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
  };

  const endMove = (event) => {
    if (event.pointerId !== mobileInput.movePointerId) return;
    mobileInput.movePointerId = null;
    mobileInput.dx = 0;
    mobileInput.dy = 0;
    ui.moveStick.classList.remove("is-active");
    ui.moveStickKnob.style.transform = "translate(-50%, -50%)";
  };

  const startAttack = (event) => {
    refreshMobileMode();
    if (!mobileInput.enabled || mobileInput.attackPointerId !== null || isOverlayOpen()) return;
    if (event.target.closest("input, select")) return;
    if (!event.target.closest("#mobileAttackButton") && !isRightSideTouch(event)) return;
    event.preventDefault();
    event.stopPropagation();
    mobileInput.attackPointerId = event.pointerId;
    mobileInput.attack = true;
    ui.mobileAttackButton.classList.add("is-active");
    event.target.setPointerCapture?.(event.pointerId);
    updateAttackAim(event);
  };

  const updateAttackAim = (event) => {
    if (event.pointerId !== mobileInput.attackPointerId) return;
    event.preventDefault();
    if (event.target.closest?.("#mobileAttackButton") && mobileInput.aimClientX === null) {
      const rect = ui.gameArea.getBoundingClientRect();
      mobileInput.aimClientX = rect.left + rect.width * 0.82;
      mobileInput.aimClientY = rect.top + rect.height * 0.5;
      return;
    }
    mobileInput.aimClientX = event.clientX;
    mobileInput.aimClientY = event.clientY;
  };

  const endAttack = (event) => {
    if (event.pointerId !== mobileInput.attackPointerId) return;
    mobileInput.attackPointerId = null;
    mobileInput.attack = false;
    ui.mobileAttackButton.classList.remove("is-active");
  };

  ui.moveStick.addEventListener("pointerdown", startMove);
  ui.mobileAttackButton.addEventListener("pointerdown", startAttack);
  ui.gameArea.addEventListener("pointerdown", startAttack);
  window.addEventListener("pointermove", (event) => {
    updateMove(event);
    updateAttackAim(event);
  }, { passive: false });
  window.addEventListener("pointerup", (event) => {
    endMove(event);
    endAttack(event);
  });
  window.addEventListener("pointercancel", (event) => {
    endMove(event);
    endAttack(event);
  });
  window.addEventListener("resize", refreshMobileMode);
  refreshMobileMode();
}

function refreshMobileMode() {
  const controlsVisible = ui.mobileControls && getComputedStyle(ui.mobileControls).display !== "none";
  mobileInput.enabled = controlsVisible || window.matchMedia("(hover: none) and (pointer: coarse)").matches || window.innerWidth <= 760 || navigator.maxTouchPoints > 0;
  if (!mobileInput.enabled) resetMobileInput();
}

function resetMobileInput() {
  mobileInput.movePointerId = null;
  mobileInput.attackPointerId = null;
  mobileInput.dx = 0;
  mobileInput.dy = 0;
  mobileInput.attack = false;
  mobileInput.aimClientX = null;
  mobileInput.aimClientY = null;
  ui.moveStick?.classList.remove("is-active");
  ui.mobileAttackButton?.classList.remove("is-active");
  if (ui.moveStickKnob) ui.moveStickKnob.style.transform = "translate(-50%, -50%)";
}

function isOverlayOpen() {
  return !ui.startScreen.classList.contains("hidden") || !ui.deathScreen.classList.contains("hidden");
}

function isRightSideTouch(event) {
  const rect = ui.gameArea.getBoundingClientRect();
  return event.clientX >= rect.left + rect.width * 0.48;
}

function getMobileAimWorldPoint(scene) {
  if (!mobileInput.enabled || mobileInput.aimClientX === null || mobileInput.aimClientY === null) return null;
  const canvas = scene.game.canvas;
  const rect = canvas.getBoundingClientRect();
  const x = (mobileInput.aimClientX - rect.left) * (canvas.width / rect.width);
  const y = (mobileInput.aimClientY - rect.top) * (canvas.height / rect.height);
  return scene.cameras.main.getWorldPoint(x, y);
}

ui.startButton.addEventListener("click", () => {
  hasStarted = true;
  ui.startScreen.classList.add("hidden");
  refreshMobileMode();
  connect(ui.heroName.value, ui.houseName.value, getSelectedAppearance());
});

ui.newHeirButton.addEventListener("click", () => {
  const nextName = ["Aren", "Mira", "Rowan", "Sel", "Tarin", "Edda"][Math.floor(Math.random() * 6)];
  ui.heroName.value = nextName;
  ui.houseName.value = meta?.dynasty || ui.houseName.value || "Valen";
  ws?.send(JSON.stringify({ t: "newHeir", name: ui.heroName.value, house: ui.houseName.value, appearance: getSelectedAppearance() }));
});

window.addEventListener("resize", () => gameScene?.resize());
setupMobileControls();
updateSidebar();

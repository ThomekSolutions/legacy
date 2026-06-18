const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = path.join(__dirname, "..", "assets", "generated-characters");
const FRAME = 100;
const ANIMS = {
  idle: 6,
  walk: 8,
  attack: 6,
};

const RENDER_ORDER = ["mount", "pet", "cape", "body", "skin", "hair", "armor", "hat", "helmet", "weapon", "shield", "aura"];
const slotLabels = {
  body: "Body",
  skin: "Skin",
  hair: "Hair",
  armor: "Armor",
  helmet: "Helmet",
  hat: "Hat",
  weapon: "Weapon",
  shield: "Shield",
  cape: "Cape",
  mount: "Mount",
  aura: "Aura",
  pet: "Pet",
};
const slotDefaults = {
  body: "human",
  skin: "pale",
  hair: "short",
  armor: "leather",
  helmet: "none",
  hat: "travelerHat",
  weapon: "sword",
  shield: "round",
  cape: "red",
  mount: "none",
  aura: "none",
  pet: "none",
};

const layers = [
  item("body", "human", "Human adventurer", "common", drawBody),
  item("skin", "pale", "Pale skin", "common", (img, f, anim) => drawSkin(img, f, anim, "#d5a577", "#f0c696")),
  item("skin", "tan", "Tan skin", "common", (img, f, anim) => drawSkin(img, f, anim, "#a96f48", "#d09161")),
  item("skin", "dark", "Dark skin", "common", (img, f, anim) => drawSkin(img, f, anim, "#6f4431", "#9a6848")),
  item("hair", "short", "Short hair", "common", (img, f, anim) => drawHair(img, f, anim, "short", "#4a2e22", "#8a5634")),
  item("hair", "long", "Long hair", "common", (img, f, anim) => drawHair(img, f, anim, "long", "#2c211b", "#755033")),
  item("hair", "wild", "Wild hair", "rare", (img, f, anim) => drawHair(img, f, anim, "wild", "#6b3f24", "#b8783f")),
  item("armor", "leather", "Leather armor", "common", (img, f, anim) => drawArmor(img, f, anim, "#8f5d36", "#c28c54", "#3b2418")),
  item("armor", "iron", "Iron armor", "common", (img, f, anim) => drawArmor(img, f, anim, "#9fa8a7", "#e0e4dc", "#46504e")),
  item("armor", "dark", "Dark armor", "rare", (img, f, anim) => drawArmor(img, f, anim, "#30363a", "#787f7b", "#111719")),
  item("helmet", "ironCap", "Iron cap", "common", (img, f, anim) => drawHelmet(img, f, anim, "#adb6b3", "#e4e8dd", false, false)),
  item("helmet", "horned", "Horned helm", "rare", (img, f, anim) => drawHelmet(img, f, anim, "#8d8f86", "#dcd5b7", true, false)),
  item("helmet", "hood", "Hunter hood", "common", (img, f, anim) => drawHelmet(img, f, anim, "#263932", "#5f7c68", false, true)),
  item("hat", "travelerHat", "Traveler hat", "common", (img, f, anim) => drawHat(img, f, anim, "traveler")),
  item("hat", "witchHat", "Witch hat", "rare", (img, f, anim) => drawHat(img, f, anim, "witch")),
  item("hat", "crown", "Old crown", "epic", (img, f, anim) => drawHat(img, f, anim, "crown")),
  item("hat", "christmasHat", "Christmas hat", "rare", (img, f, anim) => drawHat(img, f, anim, "christmas")),
  item("weapon", "sword", "Sword", "common", (img, f, anim) => drawWeapon(img, f, anim, "sword")),
  item("weapon", "axe", "Axe", "common", (img, f, anim) => drawWeapon(img, f, anim, "axe")),
  item("weapon", "staff", "Staff", "common", (img, f, anim) => drawWeapon(img, f, anim, "staff")),
  item("shield", "round", "Round shield", "common", (img, f, anim) => drawShield(img, f, anim, "round")),
  item("shield", "tower", "Tower shield", "common", (img, f, anim) => drawShield(img, f, anim, "tower")),
  item("cape", "red", "Red cape", "common", (img, f, anim) => drawCape(img, f, anim, "#9c2f35", "#d04b4f", false)),
  item("cape", "blue", "Blue cape", "common", (img, f, anim) => drawCape(img, f, anim, "#31558a", "#4f82bd", false)),
  item("cape", "green", "Green cape", "common", (img, f, anim) => drawCape(img, f, anim, "#3f6839", "#6f9a55", false)),
  item("cape", "tornBlack", "Torn black cape", "rare", (img, f, anim) => drawCape(img, f, anim, "#17191b", "#565b58", true)),
  item("mount", "horseBrown", "Brown horse", "common", (img, f, anim) => drawHorse(img, f, anim, "#6b4b2e", "#342216", "#9c7650")),
  item("mount", "horseGrey", "Grey horse", "common", (img, f, anim) => drawHorse(img, f, anim, "#898b84", "#4b4d4b", "#c2c4b6")),
  item("mount", "blackHorse", "Black horse", "rare", (img, f, anim) => drawHorse(img, f, anim, "#242322", "#0c0d0d", "#5b5d58")),
  item("mount", "emberStag", "Ember stag", "epic", drawEmberStag),
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const catalog = {
  frameWidth: FRAME,
  frameHeight: FRAME,
  animations: ANIMS,
  renderOrder: RENDER_ORDER,
  slots: Object.fromEntries(RENDER_ORDER.map((slot) => [slot, {
    label: slotLabels[slot] || slot,
    default: slotDefaults[slot] || "none",
    items: slot === "body" ? [] : [{ id: "none", label: "None", rarity: "common", defaultUnlocked: true, spritesheets: {} }],
  }])),
  layers: {},
};

for (const entry of layers) {
  const { slot: type, id: variant, label, rarity, draw } = entry;
  catalog.layers[type] ??= {};
  catalog.layers[type][variant] = {};
  catalog.slots[type] ??= { label: slotLabels[type] || type, default: "none", items: [{ id: "none", label: "None", rarity: "common", defaultUnlocked: true, spritesheets: {} }] };
  const catalogItem = { id: variant, label, rarity, defaultUnlocked: true, spritesheets: {} };
  for (const [anim, frames] of Object.entries(ANIMS)) {
    const sheet = new ImageData(FRAME * frames, FRAME);
    for (let frame = 0; frame < frames; frame += 1) {
      const frameImage = new ImageData(FRAME, FRAME);
      draw(frameImage, frame, anim);
      blit(sheet, frameImage, frame * FRAME, 0);
    }
    const filename = `${type}-${variant}-${anim}.png`;
    fs.writeFileSync(path.join(OUT_DIR, filename), encodePng(sheet));
    catalog.layers[type][variant][anim] = `assets/generated-characters/${filename}`;
    catalogItem.spritesheets[anim] = `assets/generated-characters/${filename}`;
  }
  catalog.slots[type].items.push(catalogItem);
}

fs.writeFileSync(path.join(OUT_DIR, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Generated ${layers.length * Object.keys(ANIMS).length} pixel-art spritesheets in ${OUT_DIR}`);

function item(slot, id, label, rarity, draw) {
  return { slot, id, label, rarity, draw };
}

function drawBody(img, frame, anim) {
  const pose = poseFor(frame, anim);
  const x = 50;
  const y = 52 + pose.bob;
  shadow(img, x, y + 27, 19, 4);
  rect(img, x - 8, y - 17, 16, 20, "#211817");
  rect(img, x - 6, y - 15, 12, 17, "#49372d");
  rect(img, x - 4, y - 13, 8, 4, "#71533d");
  rect(img, x - 8, y - 28, 16, 15, "#241817");
  rect(img, x - 6, y - 31, 12, 13, "#9f6d4e");
  rect(img, x + 3, y - 27, 3, 3, "#2f1d18");
  rect(img, x + 7, y - 26, 3, 5, "#9f6d4e");
  rect(img, x - 12, y - 10 + pose.armA, 5, 15, "#7d543d");
  rect(img, x + 7, y - 10 + pose.armB, 5, 15, "#7d543d");
  rect(img, x - 6 + pose.legA, y + 2, 5, 18, "#2f4350");
  rect(img, x + 1 + pose.legB, y + 2, 5, 18, "#263945");
  rect(img, x - 8 + pose.legA, y + 19, 8, 4, "#161110");
  rect(img, x + pose.legB, y + 19, 8, 4, "#161110");
  rect(img, x - 7, y + 1, 15, 3, "#211817");
}

function drawSkin(img, frame, anim, base, highlight) {
  const pose = poseFor(frame, anim);
  const x = 50;
  const y = 52 + pose.bob;
  rect(img, x - 6, y - 30, 12, 13, "#2a1713");
  rect(img, x - 5, y - 29, 10, 11, base);
  rect(img, x - 3, y - 28, 5, 4, highlight);
  rect(img, x + 3, y - 25, 2, 2, "#1a1110");
  rect(img, x + 7, y - 24, 3, 4, base);
  rect(img, x - 12, y - 7 + pose.armA, 4, 10, base);
  rect(img, x + 8, y - 7 + pose.armB, 4, 10, base);
}

function drawHair(img, frame, anim, kind, base, highlight) {
  if (kind === "none") return;
  const pose = poseFor(frame, anim);
  const x = 50;
  const y = 52 + pose.bob;
  rect(img, x - 8, y - 33, 16, 8, "#1b1311");
  rect(img, x - 7, y - 34, 14, 10, base);
  rect(img, x - 5, y - 33, 6, 3, highlight);
  if (kind === "long") {
    rect(img, x - 9, y - 25, 4, 13, base);
    rect(img, x + 5, y - 24, 4, 11, base);
  }
  if (kind === "wild") {
    rect(img, x - 12, y - 35, 5, 4, base);
    rect(img, x + 7, y - 36, 5, 5, base);
    rect(img, x - 2, y - 39, 5, 5, highlight);
  }
}

function drawArmor(img, frame, anim, base, highlight, shadowColor) {
  const pose = poseFor(frame, anim);
  const x = 50;
  const y = 52 + pose.bob;
  rect(img, x - 10, y - 17, 20, 21, "#241916");
  rect(img, x - 8, y - 16, 16, 18, base);
  rect(img, x - 5, y - 14, 10, 3, highlight);
  rect(img, x - 8, y - 7, 16, 3, shadowColor);
  rect(img, x - 7, y - 2, 14, 3, "#1b1412");
  rect(img, x - 1, y - 15, 2, 16, "#201817");
  rect(img, x - 12, y - 10 + pose.armA, 5, 12, base);
  rect(img, x + 8, y - 10 + pose.armB, 5, 12, base);
  rect(img, x - 13, y - 9 + pose.armA, 2, 10, "#241916");
  rect(img, x + 12, y - 9 + pose.armB, 2, 10, "#241916");
}

function drawHelmet(img, frame, anim, base, highlight, horned, hood) {
  const pose = poseFor(frame, anim);
  const x = 50;
  const y = 52 + pose.bob;
  if (hood) {
    rect(img, x - 9, y - 32, 18, 20, "#17221e");
    rect(img, x - 7, y - 31, 14, 16, base);
    rect(img, x - 4, y - 27, 9, 7, "#c89364");
    return;
  }
  rect(img, x - 9, y - 31, 18, 10, "#252927");
  rect(img, x - 8, y - 33, 16, 12, base);
  rect(img, x - 5, y - 32, 11, 3, highlight);
  rect(img, x + 5, y - 25, 5, 4, base);
  if (horned) {
    rect(img, x - 15, y - 33, 7, 3, highlight);
    rect(img, x + 8, y - 33, 7, 3, highlight);
    rect(img, x - 18, y - 36, 4, 3, highlight);
    rect(img, x + 14, y - 36, 4, 3, highlight);
  }
}

function drawHat(img, frame, anim, kind) {
  const pose = poseFor(frame, anim);
  const x = 50;
  const y = 52 + pose.bob;
  if (kind === "traveler") {
    rect(img, x - 15, y - 31, 30, 4, "#1d1611");
    rect(img, x - 13, y - 32, 26, 4, "#6b4829");
    rect(img, x - 8, y - 39, 16, 9, "#2f2117");
    rect(img, x - 6, y - 40, 12, 8, "#8a5d32");
    rect(img, x - 3, y - 39, 7, 2, "#c08a4d");
  }
  if (kind === "witch") {
    rect(img, x - 16, y - 31, 32, 4, "#0c0d12");
    rect(img, x - 12, y - 33, 24, 4, "#282333");
    rect(img, x - 7, y - 48, 13, 18, "#12121b");
    rect(img, x - 4, y - 51, 8, 7, "#201b2a");
    rect(img, x + 2, y - 46, 4, 15, "#5b496a");
  }
  if (kind === "crown") {
    rect(img, x - 9, y - 34, 18, 5, "#6b4512");
    rect(img, x - 8, y - 36, 4, 7, "#d4a63a");
    rect(img, x - 2, y - 39, 4, 10, "#f0d46b");
    rect(img, x + 5, y - 36, 4, 7, "#d4a63a");
    rect(img, x - 6, y - 34, 12, 2, "#fff0a8");
  }
  if (kind === "christmas") {
    const sway = anim === "walk" ? Math.round(Math.sin(frame / ANIMS.walk * Math.PI * 2) * 1.5) : anim === "attack" ? Math.min(frame, 3) - 1 : 0;
    rect(img, x - 12, y - 32, 24, 5, "#30221d");
    rect(img, x - 11, y - 33, 22, 5, "#e8e0c8");
    rect(img, x - 8, y - 37, 15, 6, "#7d161d");
    rect(img, x - 6, y - 42, 13, 7, "#a8202a");
    rect(img, x - 2, y - 47, 11, 8, "#b92631");
    rect(img, x + 5 + sway, y - 49, 7, 6, "#6f141a");
    rect(img, x + 10 + sway, y - 48, 6, 6, "#eee9d7");
    rect(img, x + 11 + sway, y - 47, 4, 4, "#fff8e8");
    rect(img, x - 4, y - 40, 6, 3, "#d03a42");
  }
}

function drawWeapon(img, frame, anim, kind) {
  const pose = poseFor(frame, anim);
  const swing = anim === "attack" ? Math.min(frame, 4) : 0;
  const x = 50 + 11 + swing * 4;
  const y = 52 + pose.bob - 2 - swing;
  if (kind === "sword") {
    lineRect(img, x + 2, y + 1, 28, 4, "#d7d7ca");
    rect(img, x + 3, y + 2, 8, 2, "#7f5b31");
    rect(img, x + 28, y, 5, 6, "#ececdd");
  }
  if (kind === "axe") {
    lineRect(img, x + 1, y + 2, 25, 4, "#80572f");
    rect(img, x + 24, y - 5, 9, 13, "#b9bdb7");
    rect(img, x + 29, y - 2, 5, 7, "#d8dacf");
  }
  if (kind === "staff") {
    lineRect(img, x, y + 2, 34, 4, "#8d6136");
    rect(img, x + 30, y - 2, 6, 8, "#5c8d71");
  }
}

function drawShield(img, frame, anim, kind) {
  const pose = poseFor(frame, anim);
  const x = 36;
  const y = 53 + pose.bob;
  const color = kind === "tower" ? "#747c78" : "#8c5f33";
  const light = kind === "tower" ? "#afb5ad" : "#c4904f";
  if (kind === "tower") {
    rect(img, x - 5, y - 15, 12, 27, "#25201a");
    rect(img, x - 4, y - 14, 10, 25, color);
    rect(img, x - 2, y - 11, 6, 4, light);
  } else {
    rect(img, x - 8, y - 11, 16, 22, "#25201a");
    rect(img, x - 7, y - 10, 14, 20, color);
    rect(img, x - 3, y - 7, 7, 5, light);
  }
}

function drawCape(img, frame, anim, base, highlight, torn) {
  const pose = poseFor(frame, anim);
  const x = 45;
  const y = 57 + pose.bob;
  const sway = anim === "walk" ? Math.round(Math.sin(frame / ANIMS.walk * Math.PI * 2) * 2) : 0;
  rect(img, x - 8, y - 18, 17, 28, "#211717");
  rect(img, x - 7 + sway, y - 17, 15, 26, base);
  rect(img, x - 4 + sway, y - 15, 6, 18, highlight);
  rect(img, x - 5 + pose.legA + sway, y + 7, 12, 5, base);
  if (torn) {
    rect(img, x - 7 + sway, y + 5, 4, 8, "#080909");
    rect(img, x + 4 + sway, y + 8, 4, 7, "#080909");
  }
}

function drawHorse(img, frame, anim, color, dark, light) {
  const pose = poseFor(frame, anim);
  const x = 50;
  const y = 68 + (anim === "walk" ? Math.round(Math.sin(frame / 8 * Math.PI * 2)) : 0);
  shadow(img, x, y + 17, 30, 5);
  rect(img, x - 24, y - 12, 46, 23, "#201915");
  rect(img, x - 22, y - 14, 44, 22, color);
  rect(img, x + 18, y - 22, 17, 18, color);
  rect(img, x + 30, y - 19, 8, 8, color);
  rect(img, x + 16, y - 23, 5, 17, dark);
  rect(img, x - 12, y - 17, 20, 5, light);
  rect(img, x - 9, y - 19, 18, 7, "#5a3824");
  rect(img, x + 31, y - 16, 2, 2, "#f4e7bf");
  rect(img, x - 18 + pose.legA, y + 6, 5, 20, dark);
  rect(img, x - 2 + pose.legB, y + 6, 5, 20, dark);
  rect(img, x + 12 + pose.legB, y + 6, 5, 20, dark);
  rect(img, x + 27 + pose.legA, y - 5, 4, 18, dark);
}

function drawEmberStag(img, frame, anim) {
  const pose = poseFor(frame, anim);
  const x = 50;
  const y = 67 + (anim === "walk" ? Math.round(Math.sin(frame / 8 * Math.PI * 2)) : 0);
  const flame = anim === "attack" ? Math.min(frame, 3) : anim === "walk" ? Math.abs(pose.legA) : frame % 3;
  shadow(img, x, y + 18, 31, 5);
  rect(img, x - 25, y - 13, 47, 24, "#160f11");
  rect(img, x - 23, y - 15, 45, 22, "#342328");
  rect(img, x - 17, y - 17, 29, 7, "#5b3130");
  rect(img, x - 9, y - 18, 12, 6, "#d06b33");
  rect(img, x + 16, y - 24, 18, 20, "#21171a");
  rect(img, x + 18, y - 26, 16, 18, "#3d2729");
  rect(img, x + 29, y - 23, 8, 8, "#4a2d2d");
  rect(img, x + 32, y - 20, 2, 2, "#ffd98a");
  rect(img, x + 18, y - 30, 4, 10, "#8a5525");
  rect(img, x + 24, y - 32, 4, 12, "#d69a3a");
  rect(img, x + 16, y - 35, 12, 3, "#e7bd66");
  rect(img, x + 25, y - 38, 12, 3, "#f0cf7a");
  rect(img, x + 12, y - 41, 7, 3, "#d69a3a");
  rect(img, x + 32, y - 44, 6, 3, "#f0cf7a");
  rect(img, x - 24, y - 11, 7, 8, "#23171a");
  rect(img, x - 31, y - 15 - flame, 8, 14 + flame, "#7b2321");
  rect(img, x - 29, y - 18 - flame, 6, 11 + flame, "#d8582d");
  rect(img, x - 27, y - 20 - flame, 4, 8 + flame, "#ffc05b");
  rect(img, x - 20 + pose.legA, y + 6, 5, 21, "#171012");
  rect(img, x - 4 + pose.legB, y + 6, 5, 22, "#1d1214");
  rect(img, x + 12 + pose.legB, y + 6, 5, 21, "#171012");
  rect(img, x + 27 + pose.legA, y - 5, 4, 19, "#1d1214");
  rect(img, x - 20 + pose.legA, y + 25, 7, 3, "#d06b33");
  rect(img, x - 4 + pose.legB, y + 27, 7, 3, "#f29a42");
  rect(img, x + 12 + pose.legB, y + 25, 7, 3, "#d06b33");
  rect(img, x + 27 + pose.legA, y + 12, 6, 3, "#f29a42");
  rect(img, x - 4, y - 22 - flame, 5, 9, "#7b2321");
  rect(img, x - 2, y - 25 - flame, 4, 8, "#e05c2e");
  rect(img, x, y - 27 - flame, 3, 5, "#ffd36e");
}

function poseFor(frame, anim) {
  if (anim === "walk") {
    const phase = frame / ANIMS.walk * Math.PI * 2;
    return {
      bob: Math.round(Math.sin(phase) * 2),
      legA: Math.round(Math.sin(phase) * 3),
      legB: Math.round(Math.sin(phase + Math.PI) * 3),
      armA: Math.round(Math.sin(phase + Math.PI) * 3),
      armB: Math.round(Math.sin(phase) * 3),
    };
  }
  if (anim === "attack") {
    return {
      bob: frame === 2 || frame === 3 ? -1 : 0,
      legA: frame >= 2 ? 2 : 0,
      legB: frame >= 2 ? -1 : 0,
      armA: 0,
      armB: frame >= 1 && frame <= 4 ? -3 : 0,
    };
  }
  return {
    bob: frame === 1 || frame === 2 ? -1 : 0,
    legA: 0,
    legB: 0,
    armA: 0,
    armB: 0,
  };
}

function shadow(img, cx, cy, rx, ry) {
  for (let y = -ry; y <= ry; y += 1) {
    for (let x = -rx; x <= rx; x += 1) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) setPixel(img, cx + x, cy + y, "#000000", 70);
    }
  }
}

function lineRect(img, x, y, width, height, color) {
  rect(img, x, y, width, height, "#2b2119");
  rect(img, x + 1, y + 1, width - 2, Math.max(1, height - 2), color);
}

function rect(img, x, y, width, height, color) {
  for (let yy = Math.round(y); yy < Math.round(y + height); yy += 1) {
    for (let xx = Math.round(x); xx < Math.round(x + width); xx += 1) setPixel(img, xx, yy, color, 255);
  }
}

function setPixel(img, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const [r, g, b] = hexToRgb(color);
  const i = (Math.floor(y) * img.width + Math.floor(x)) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = alpha;
}

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blit(target, source, ox, oy) {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const si = (y * source.width + x) * 4;
      const ti = ((y + oy) * target.width + x + ox) * 4;
      target.data[ti] = source.data[si];
      target.data[ti + 1] = source.data[si + 1];
      target.data[ti + 2] = source.data[si + 2];
      target.data[ti + 3] = source.data[si + 3];
    }
  }
}

function encodePng(img) {
  const scanline = img.width * 4 + 1;
  const raw = Buffer.alloc(scanline * img.height);
  for (let y = 0; y < img.height; y += 1) {
    raw[y * scanline] = 0;
    img.data.copy(raw, y * scanline + 1, y * img.width * 4, (y + 1) * img.width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", Buffer.concat([u32(img.width), u32(img.height), Buffer.from([8, 6, 0, 0, 0])])),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  return Buffer.concat([u32(data.length), name, data, u32(crc32(Buffer.concat([name, data])))]); 
}

function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value >>> 0);
  return b;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function ImageData(width, height) {
  this.width = width;
  this.height = height;
  this.data = Buffer.alloc(width * height * 4);
}

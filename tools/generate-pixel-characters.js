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

const layers = [
  ["body", "human", drawBody],
  ["armor", "leather", (img, f, anim) => drawArmor(img, f, anim, "#8f5d36", "#c28c54")],
  ["armor", "iron", (img, f, anim) => drawArmor(img, f, anim, "#9fa8a7", "#e0e4dc")],
  ["armor", "dark", (img, f, anim) => drawArmor(img, f, anim, "#30363a", "#646c69")],
  ["helmet", "ironCap", (img, f, anim) => drawHelmet(img, f, anim, "#adb6b3", "#e4e8dd", false, false)],
  ["helmet", "horned", (img, f, anim) => drawHelmet(img, f, anim, "#8d8f86", "#dcd5b7", true, false)],
  ["helmet", "hood", (img, f, anim) => drawHelmet(img, f, anim, "#263932", "#47624f", false, true)],
  ["weapon", "sword", (img, f, anim) => drawWeapon(img, f, anim, "sword")],
  ["weapon", "axe", (img, f, anim) => drawWeapon(img, f, anim, "axe")],
  ["weapon", "staff", (img, f, anim) => drawWeapon(img, f, anim, "staff")],
  ["shield", "round", (img, f, anim) => drawShield(img, f, anim, "round")],
  ["shield", "tower", (img, f, anim) => drawShield(img, f, anim, "tower")],
  ["cape", "red", (img, f, anim) => drawCape(img, f, anim, "#9c2f35", "#d04b4f")],
  ["cape", "blue", (img, f, anim) => drawCape(img, f, anim, "#31558a", "#4f82bd")],
  ["cape", "green", (img, f, anim) => drawCape(img, f, anim, "#3f6839", "#6f9a55")],
  ["mount", "horseBrown", (img, f, anim) => drawHorse(img, f, anim, "#6b4b2e", "#342216")],
  ["mount", "horseGrey", (img, f, anim) => drawHorse(img, f, anim, "#898b84", "#4b4d4b")],
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const catalog = {
  frameWidth: FRAME,
  frameHeight: FRAME,
  animations: ANIMS,
  layers: {},
};

for (const [type, variant, draw] of layers) {
  catalog.layers[type] ??= {};
  catalog.layers[type][variant] = {};
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
  }
}

fs.writeFileSync(path.join(OUT_DIR, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Generated ${layers.length * Object.keys(ANIMS).length} pixel-art spritesheets in ${OUT_DIR}`);

function drawBody(img, frame, anim) {
  const pose = poseFor(frame, anim);
  const x = 50;
  const y = 52 + pose.bob;
  shadow(img, x, y + 27, 19, 4);
  rect(img, x - 7, y - 15, 14, 18, "#6f4431");
  rect(img, x - 5, y - 13, 10, 14, "#c18b5f");
  rect(img, x - 8, y - 28, 16, 15, "#5a3328");
  rect(img, x - 6, y - 31, 12, 13, "#c89364");
  rect(img, x + 3, y - 27, 3, 3, "#2f1d18");
  rect(img, x + 7, y - 26, 3, 5, "#c89364");
  rect(img, x - 12, y - 10, 5, 15, "#c89364");
  rect(img, x + 7, y - 10, 5, 15, "#c89364");
  rect(img, x - 6 + pose.legA, y + 2, 5, 18, "#3f5361");
  rect(img, x + 1 + pose.legB, y + 2, 5, 18, "#364b59");
  rect(img, x - 8 + pose.legA, y + 19, 8, 4, "#251917");
  rect(img, x + pose.legB, y + 19, 8, 4, "#251917");
  rect(img, x - 11, y - 8 + pose.armA, 4, 13, "#8a5740");
  rect(img, x + 8, y - 8 + pose.armB, 4, 13, "#8a5740");
}

function drawArmor(img, frame, anim, base, highlight) {
  const pose = poseFor(frame, anim);
  const x = 50;
  const y = 52 + pose.bob;
  rect(img, x - 10, y - 17, 20, 21, "#241916");
  rect(img, x - 8, y - 16, 16, 18, base);
  rect(img, x - 5, y - 14, 10, 3, highlight);
  rect(img, x - 7, y - 2, 14, 3, "#2b201c");
  rect(img, x - 12, y - 10 + pose.armA, 5, 12, base);
  rect(img, x + 8, y - 10 + pose.armB, 5, 12, base);
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

function drawCape(img, frame, anim, base, highlight) {
  const pose = poseFor(frame, anim);
  const x = 45;
  const y = 57 + pose.bob;
  rect(img, x - 8, y - 18, 17, 28, "#211717");
  rect(img, x - 7, y - 17, 15, 26, base);
  rect(img, x - 4, y - 15, 6, 18, highlight);
  rect(img, x - 5 + pose.legA, y + 7, 12, 5, base);
}

function drawHorse(img, frame, anim, color, dark) {
  const pose = poseFor(frame, anim);
  const x = 50;
  const y = 68 + (anim === "walk" ? Math.round(Math.sin(frame / 8 * Math.PI * 2)) : 0);
  shadow(img, x, y + 17, 30, 5);
  rect(img, x - 24, y - 12, 46, 23, "#201915");
  rect(img, x - 22, y - 14, 44, 22, color);
  rect(img, x + 18, y - 22, 17, 18, color);
  rect(img, x + 30, y - 19, 8, 8, color);
  rect(img, x + 16, y - 23, 5, 17, dark);
  rect(img, x - 9, y - 19, 18, 7, "#5a3824");
  rect(img, x - 18 + pose.legA, y + 6, 5, 20, dark);
  rect(img, x - 2 + pose.legB, y + 6, 5, 20, dark);
  rect(img, x + 12 + pose.legB, y + 6, 5, 20, dark);
  rect(img, x + 27 + pose.legA, y - 5, 4, 18, dark);
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

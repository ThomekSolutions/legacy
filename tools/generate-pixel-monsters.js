const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = path.join(__dirname, "..", "assets", "generated-monsters");
const FRAME = 100;
const ANIMS = {
  idle: 6,
  walk: 8,
  attack: 6,
};

const monsters = [
  monster("ruinCrawler", "Ruin crawler", "low", drawRuinCrawler),
  monster("marshMaw", "Marsh maw", "mid", drawMarshMaw),
  monster("graveWraith", "Grave wraith", "mid", drawGraveWraith),
  monster("cinderBrute", "Cinder brute", "high", drawCinderBrute),
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const catalog = {
  frameWidth: FRAME,
  frameHeight: FRAME,
  animations: ANIMS,
  monsters: [],
};

for (const entry of monsters) {
  const catalogItem = { id: entry.id, label: entry.label, tier: entry.tier, spritesheets: {} };
  for (const [anim, frames] of Object.entries(ANIMS)) {
    const sheet = new ImageData(FRAME * frames, FRAME);
    for (let frame = 0; frame < frames; frame += 1) {
      const frameImage = new ImageData(FRAME, FRAME);
      entry.draw(frameImage, frame, anim);
      blit(sheet, frameImage, frame * FRAME, 0);
    }
    const filename = `${entry.id}-${anim}.png`;
    fs.writeFileSync(path.join(OUT_DIR, filename), encodePng(sheet));
    catalogItem.spritesheets[anim] = `assets/generated-monsters/${filename}`;
  }
  catalog.monsters.push(catalogItem);
}

fs.writeFileSync(path.join(OUT_DIR, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Generated ${monsters.length * Object.keys(ANIMS).length} monster spritesheets in ${OUT_DIR}`);

function monster(id, label, tier, draw) {
  return { id, label, tier, draw };
}

function drawRuinCrawler(img, frame, anim) {
  const pose = monsterPose(frame, anim);
  const x = 50;
  const y = 66 + pose.bob;
  const crawl = anim === "walk" ? pose.legA : 0;
  const bite = anim === "attack" ? Math.min(frame, 3) * 2 : 0;
  shadow(img, x, y + 15, 24, 5);
  rect(img, x - 23, y - 9, 42, 19, "#171718");
  rect(img, x - 21, y - 11, 40, 18, "#393838");
  rect(img, x - 16, y - 14, 25, 7, "#62615a");
  rect(img, x + 13, y - 18 - bite, 16, 15 + bite, "#242323");
  rect(img, x + 15, y - 19 - bite, 14, 13 + bite, "#55524b");
  rect(img, x + 25, y - 14 - bite, 3, 3, "#f0d36b");
  rect(img, x + 18, y - 6, 12, 3, "#120e0d");
  rect(img, x + 20, y - 5, 3, 5 + bite, "#d8d0b0");
  rect(img, x + 25, y - 5, 3, 5 + bite, "#d8d0b0");
  for (let i = 0; i < 4; i += 1) {
    const lx = x - 18 + i * 10;
    const offset = i % 2 === 0 ? crawl : -crawl;
    rect(img, lx + offset, y + 5, 4, 14, "#1c1b1b");
    rect(img, lx - 2 + offset, y + 17, 8, 3, "#55524b");
  }
  rect(img, x - 27, y - 8, 8, 5, "#211f1e");
  rect(img, x - 30, y - 10, 5, 4, "#767068");
}

function drawMarshMaw(img, frame, anim) {
  const pose = monsterPose(frame, anim);
  const x = 50;
  const y = 62 + pose.bob;
  const open = anim === "attack" ? Math.min(frame, 3) * 2 : frame % 2;
  shadow(img, x, y + 20, 25, 6);
  rect(img, x - 21, y - 11, 42, 27, "#10241d");
  rect(img, x - 19, y - 14, 39, 25, "#244c38");
  rect(img, x - 11, y - 17, 24, 7, "#40724f");
  rect(img, x + 8, y - 9 - open, 20, 16 + open, "#152820");
  rect(img, x + 10, y - 7 - open, 16, 12 + open, "#5c1f25");
  rect(img, x + 12, y - 8 - open, 5, 3, "#e8dec4");
  rect(img, x + 20, y - 8 - open, 5, 3, "#e8dec4");
  rect(img, x + 17, y - 19, 3, 3, "#b7e37c");
  rect(img, x + 25, y - 17, 3, 3, "#b7e37c");
  rect(img, x - 16 + pose.legA, y + 10, 5, 16, "#13271f");
  rect(img, x - 2 + pose.legB, y + 10, 5, 17, "#173125");
  rect(img, x + 13 + pose.legB, y + 9, 5, 15, "#13271f");
  rect(img, x - 24, y - 10, 8, 18, "#1e3b2d");
  rect(img, x - 26, y - 16, 5, 8, "#567d43");
  rect(img, x - 11, y - 22, 5, 8, "#567d43");
}

function drawGraveWraith(img, frame, anim) {
  const pose = monsterPose(frame, anim);
  const x = 50;
  const y = 57 + pose.bob + (anim === "walk" ? Math.round(Math.sin(frame / ANIMS.walk * Math.PI * 2)) : 0);
  const flare = anim === "attack" ? Math.min(frame, 3) : 0;
  shadow(img, x, y + 28, 18, 4);
  rect(img, x - 15, y - 26, 30, 16, "#1a2026");
  rect(img, x - 13, y - 28, 26, 16, "#53606b");
  rect(img, x - 8, y - 25, 16, 7, "#b8c7cf");
  rect(img, x - 6, y - 22, 4, 4, "#75d8f0");
  rect(img, x + 4, y - 22, 4, 4, "#75d8f0");
  rect(img, x - 18, y - 13, 36, 27 + flare, "#141a20");
  rect(img, x - 16, y - 14, 32, 25 + flare, "#617080");
  rect(img, x - 10, y - 12, 9, 28 + flare, "#9fb2bd");
  rect(img, x - 18 - flare, y - 9, 7, 20, "#7f929e");
  rect(img, x + 12 + flare, y - 9, 7, 20, "#7f929e");
  rect(img, x - 14, y + 10, 8, 13, "#53606b");
  rect(img, x - 2, y + 11, 7, 17, "#53606b");
  rect(img, x + 9, y + 10, 6, 12, "#53606b");
  rect(img, x - 24 - flare, y - 18, 4, 4, "#8ee8ff");
  rect(img, x + 21 + flare, y - 18, 4, 4, "#8ee8ff");
}

function drawCinderBrute(img, frame, anim) {
  const pose = monsterPose(frame, anim);
  const x = 50;
  const y = 61 + pose.bob;
  const slam = anim === "attack" ? Math.min(frame, 3) * 2 : 0;
  shadow(img, x, y + 22, 26, 6);
  rect(img, x - 18, y - 24, 36, 18, "#160f10");
  rect(img, x - 16, y - 26, 32, 18, "#322024");
  rect(img, x - 10, y - 23, 7, 5, "#f18a36");
  rect(img, x + 5, y - 23, 7, 5, "#f18a36");
  rect(img, x - 20, y - 8, 40, 31, "#171011");
  rect(img, x - 18, y - 10, 36, 29, "#3a2223");
  rect(img, x - 11, y - 7, 20, 7, "#6f3330");
  rect(img, x - 4, y + 2, 7, 9, "#e05d2e");
  rect(img, x - 5, y + 3, 3, 5, "#ffd066");
  rect(img, x - 30 - slam, y - 7, 12, 28, "#120d0e");
  rect(img, x - 28 - slam, y - 8, 10, 25, "#4a2828");
  rect(img, x + 18 + slam, y - 7, 12, 28, "#120d0e");
  rect(img, x + 18 + slam, y - 8, 10, 25, "#4a2828");
  rect(img, x - 13 + pose.legA, y + 18, 8, 20, "#160f10");
  rect(img, x + 5 + pose.legB, y + 18, 8, 20, "#160f10");
  rect(img, x - 16 + pose.legA, y + 36, 13, 4, "#df6c2e");
  rect(img, x + 4 + pose.legB, y + 36, 13, 4, "#df6c2e");
  rect(img, x - 22, y - 28, 8, 5, "#92502d");
  rect(img, x + 14, y - 28, 8, 5, "#92502d");
}

function monsterPose(frame, anim) {
  if (anim === "walk") {
    const phase = frame / ANIMS.walk * Math.PI * 2;
    return {
      bob: Math.round(Math.sin(phase) * 2),
      legA: Math.round(Math.sin(phase) * 3),
      legB: Math.round(Math.sin(phase + Math.PI) * 3),
    };
  }
  if (anim === "attack") {
    return {
      bob: frame === 2 || frame === 3 ? -1 : 0,
      legA: frame >= 2 ? 2 : 0,
      legB: frame >= 2 ? -1 : 0,
    };
  }
  return {
    bob: frame === 1 || frame === 2 ? -1 : 0,
    legA: 0,
    legB: 0,
  };
}

function shadow(img, cx, cy, rx, ry) {
  for (let y = -ry; y <= ry; y += 1) {
    for (let x = -rx; x <= rx; x += 1) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) setPixel(img, cx + x, cy + y, "#000000", 70);
    }
  }
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

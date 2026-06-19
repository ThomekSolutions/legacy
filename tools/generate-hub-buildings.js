const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = path.join(__dirname, "..", "assets", "hub");
const SIZE = 128;

class ImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
  }
}

const buildings = [
  ["forge.png", drawForge],
  ["marketplace.png", drawMarketplace],
  ["leaderboard.png", drawLeaderboard],
  ["wishing-well.png", drawWishingWell],
];

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [filename, draw] of buildings) {
  const img = new ImageData(SIZE, SIZE);
  draw(img);
  fs.writeFileSync(path.join(OUT_DIR, filename), encodePng(img));
}

console.log(`Generated ${buildings.length} hub buildings in ${OUT_DIR}`);

function drawForge(img) {
  shadow(img, 65, 99, 42, 9);
  rect(img, 29, 62, 65, 30, "#241c17");
  rect(img, 32, 58, 59, 30, "#5c3b24");
  rect(img, 37, 63, 49, 20, "#8a6038");
  rect(img, 43, 70, 14, 18, "#1d1714");
  rect(img, 46, 74, 9, 10, "#f0782f");
  rect(img, 48, 76, 5, 6, "#ffd06a");
  rect(img, 64, 69, 15, 20, "#2f2a26");
  rect(img, 68, 73, 7, 9, "#151312");
  roof(img, 25, 47, 72, 21, "#3c2417", "#7a4426");
  rect(img, 34, 44, 13, 15, "#2b211b");
  rect(img, 37, 39, 7, 7, "#5a3522");
  rect(img, 38, 35, 5, 4, "#e56c2d");
  rect(img, 39, 33, 3, 2, "#ffd067");
  rect(img, 22, 83, 14, 8, "#2b2925");
  rect(img, 24, 80, 10, 4, "#797061");
  rect(img, 92, 83, 13, 5, "#3a2a20");
  rect(img, 94, 78, 9, 5, "#806040");
  rect(img, 20, 91, 87, 3, "#151211");
  sparkle(img, 56, 78, "#ffd067");
}

function drawMarketplace(img) {
  shadow(img, 64, 100, 45, 9);
  rect(img, 31, 60, 66, 31, "#2a211a");
  rect(img, 34, 57, 60, 30, "#775737");
  rect(img, 39, 64, 15, 21, "#3e2b1f");
  rect(img, 60, 67, 27, 13, "#a3834c");
  rect(img, 63, 70, 8, 5, "#d4ba6a");
  rect(img, 75, 70, 8, 5, "#6d8f43");
  rect(img, 83, 80, 10, 8, "#4a3321");
  rect(img, 23, 54, 82, 14, "#7f2830");
  rect(img, 25, 48, 78, 10, "#b4473f");
  rect(img, 25, 58, 13, 12, "#d8c987");
  rect(img, 50, 58, 13, 12, "#d8c987");
  rect(img, 75, 58, 13, 12, "#d8c987");
  rect(img, 34, 42, 60, 8, "#5b3426");
  rect(img, 29, 88, 11, 8, "#5b3c25");
  rect(img, 92, 87, 12, 10, "#5b3c25");
  rect(img, 21, 93, 88, 3, "#171311");
}

function drawLeaderboard(img) {
  shadow(img, 64, 99, 38, 8);
  rect(img, 32, 73, 8, 25, "#3b2a1d");
  rect(img, 88, 73, 8, 25, "#3b2a1d");
  rect(img, 29, 44, 70, 39, "#2b2119");
  rect(img, 33, 40, 62, 39, "#6a4528");
  rect(img, 39, 48, 50, 23, "#c7b98b");
  rect(img, 43, 52, 31, 3, "#62533d");
  rect(img, 43, 59, 38, 3, "#62533d");
  rect(img, 43, 66, 28, 3, "#62533d");
  rect(img, 49, 29, 30, 14, "#6c4626");
  rect(img, 53, 25, 22, 8, "#d0a548");
  rect(img, 59, 19, 10, 8, "#f0d36b");
  rect(img, 61, 14, 6, 7, "#f7df82");
  rect(img, 44, 35, 8, 16, "#27495d");
  rect(img, 76, 35, 8, 16, "#27495d");
  rect(img, 35, 82, 58, 7, "#54402b");
  rect(img, 24, 95, 80, 4, "#171311");
}

function drawWishingWell(img) {
  shadow(img, 64, 99, 30, 7);
  rect(img, 44, 73, 40, 20, "#2a2622");
  rect(img, 47, 69, 34, 23, "#6c6f68");
  rect(img, 50, 73, 28, 6, "#97998d");
  rect(img, 51, 82, 26, 6, "#4e5550");
  rect(img, 55, 84, 18, 6, "#15333a");
  rect(img, 57, 85, 14, 4, "#42b4c8");
  rect(img, 41, 51, 6, 25, "#5b3b25");
  rect(img, 81, 51, 6, 25, "#5b3b25");
  roof(img, 38, 39, 52, 17, "#64371f", "#a86130");
  rect(img, 53, 56, 22, 3, "#3b2a1d");
  rect(img, 62, 58, 4, 13, "#241c17");
  rect(img, 60, 68, 8, 7, "#8a6038");
  rect(img, 31, 94, 67, 3, "#151211");
  sparkle(img, 62, 86, "#8ee8ff");
  sparkle(img, 69, 84, "#d9fbff");
}

function roof(img, x, y, width, height, dark, mid) {
  for (let row = 0; row < height; row += 1) {
    const inset = Math.floor(row * 1.7);
    rect(img, x + inset, y + row, width - inset * 2, 1, row % 3 === 0 ? dark : mid);
  }
  rect(img, x + 4, y + height - 3, width - 8, 3, dark);
}

function shadow(img, cx, cy, rx, ry) {
  for (let y = -ry; y <= ry; y += 1) {
    for (let x = -rx; x <= rx; x += 1) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) setPixel(img, cx + x, cy + y, "#000000", 70);
    }
  }
}

function sparkle(img, x, y, color) {
  rect(img, x, y - 2, 1, 5, color);
  rect(img, x - 2, y, 5, 1, color);
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
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const CATALOG_FILE = path.join(ROOT, "assets", "generated-monsters", "catalog.json");
const failures = [];

if (!fs.existsSync(CATALOG_FILE)) {
  failures.push(`Missing monster catalog: ${path.relative(ROOT, CATALOG_FILE)}`);
} else {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
  const expectedAnims = Object.entries(catalog.animations || {});
  const frameWidth = catalog.frameWidth;
  const frameHeight = catalog.frameHeight;

  for (const monster of catalog.monsters || []) {
    if (!monster.id) failures.push("Monster entry missing id");
    for (const [anim, frames] of expectedAnims) {
      const assetPath = monster.spritesheets?.[anim];
      if (!assetPath) {
        failures.push(`${monster.id || "unknown"}.${anim} missing spritesheet`);
        continue;
      }
      const absolutePath = path.join(ROOT, assetPath);
      if (!fs.existsSync(absolutePath)) {
        failures.push(`${monster.id}.${anim} missing file ${assetPath}`);
        continue;
      }
      const png = readPng(absolutePath);
      if (png.width !== frameWidth * frames || png.height !== frameHeight) {
        failures.push(`${assetPath} has ${png.width}x${png.height}, expected ${frameWidth * frames}x${frameHeight}`);
      }
      for (let frame = 0; frame < frames; frame += 1) {
        if (!frameHasPixels(png, frame, frameWidth, frameHeight)) failures.push(`${assetPath} frame ${frame} is empty`);
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Monster asset verification passed.");

function readPng(filePath) {
  const bytes = fs.readFileSync(filePath);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const idat = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return { width, height, raw: zlib.inflateSync(Buffer.concat(idat)) };
}

function frameHasPixels(png, frame, width, height) {
  const scanline = png.width * 4 + 1;
  const startX = frame * width;
  for (let y = 0; y < height; y += 1) {
    const row = y * scanline + 1;
    for (let x = startX; x < startX + width; x += 1) {
      if (png.raw[row + x * 4 + 3] > 0) return true;
    }
  }
  return false;
}

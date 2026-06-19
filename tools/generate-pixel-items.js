const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = path.join(__dirname, "..", "assets", "generated-items");
const SIZE = 32;

class ImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
  }
}

const items = [
  item("helmet", "patched-cap", "Patched Cap", drawHelmet),
  item("helmet", "rusted-sallet", "Rusted Sallet", drawHelmet),
  item("helmet", "grave-crown", "Grave Crown", drawHelmet),
  item("helmet", "ember-hood", "Ember Hood", drawHelmet),
  item("chest", "travelers-vest", "Traveler's Vest", drawChest),
  item("chest", "ringmail-vest", "Ringmail Vest", drawChest),
  item("chest", "warden-coat", "Warden Coat", drawChest),
  item("chest", "ashen-cuirass", "Ashen Cuirass", drawChest),
  item("gloves", "linen-wraps", "Linen Wraps", drawGloves),
  item("gloves", "iron-grips", "Iron Grips", drawGloves),
  item("gloves", "grave-gauntlets", "Grave Gauntlets", drawGloves),
  item("gloves", "ember-claws", "Ember Claws", drawGloves),
  item("boots", "mud-boots", "Mud Boots", drawBoots),
  item("boots", "scout-boots", "Scout Boots", drawBoots),
  item("boots", "tomb-greaves", "Tomb Greaves", drawBoots),
  item("boots", "cinder-treads", "Cinder Treads", drawBoots),
  item("weapon", "chipped-sword", "Chipped Sword", drawWeapon),
  item("weapon", "hunter-axe", "Hunter Axe", drawWeapon),
  item("weapon", "grave-mace", "Grave Mace", drawWeapon),
  item("weapon", "ember-blade", "Ember Blade", drawWeapon),
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const catalog = { frameWidth: SIZE, frameHeight: SIZE, items: [] };
for (const entry of items) {
  const img = new ImageData(SIZE, SIZE);
  entry.draw(img, paletteFor(entry.id));
  const filename = `${entry.id}.png`;
  fs.writeFileSync(path.join(OUT_DIR, filename), encodePng(img));
  catalog.items.push({ id: entry.id, type: entry.type, label: entry.label, icon: `assets/generated-items/${filename}` });
}

const equipmentIcon = new ImageData(SIZE, SIZE);
drawEquipmentIcon(equipmentIcon);
fs.writeFileSync(path.join(OUT_DIR, "equipment-icon.png"), encodePng(equipmentIcon));

fs.writeFileSync(path.join(OUT_DIR, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Generated ${items.length} item icons and HUD equipment icon in ${OUT_DIR}`);

function item(type, id, label, draw) {
  return { type, id, label, draw };
}

function paletteFor(id) {
  if (id.includes("ember") || id.includes("cinder") || id.includes("ashen")) return ["#251814", "#a53c20", "#f1973c", "#ffd37a"];
  if (id.includes("grave") || id.includes("tomb")) return ["#181a22", "#4f5874", "#9ea9d1", "#e5e2ce"];
  if (id.includes("iron") || id.includes("rusted") || id.includes("ringmail")) return ["#171716", "#6c6252", "#b9aa8d", "#f0dca7"];
  if (id.includes("hunter") || id.includes("scout") || id.includes("warden")) return ["#10190f", "#38623b", "#8ea35d", "#e7d29a"];
  return ["#15110d", "#6b4425", "#b78448", "#e8c477"];
}

function drawHelmet(img, p) {
  shadow(img);
  rect(img, 8, 14, 16, 8, p[1]);
  rect(img, 10, 9, 12, 9, p[2]);
  rect(img, 12, 7, 8, 3, p[3]);
  rect(img, 9, 17, 14, 2, p[0]);
}

function drawChest(img, p) {
  shadow(img);
  rect(img, 10, 8, 12, 5, p[2]);
  rect(img, 7, 13, 18, 13, p[1]);
  rect(img, 14, 13, 4, 13, p[0]);
  rect(img, 8, 24, 16, 2, p[3]);
}

function drawGloves(img, p) {
  shadow(img);
  rect(img, 7, 13, 7, 10, p[1]);
  rect(img, 18, 13, 7, 10, p[1]);
  rect(img, 8, 11, 5, 4, p[2]);
  rect(img, 19, 11, 5, 4, p[2]);
  rect(img, 6, 21, 8, 3, p[3]);
  rect(img, 18, 21, 8, 3, p[3]);
}

function drawBoots(img, p) {
  shadow(img);
  rect(img, 9, 9, 6, 14, p[1]);
  rect(img, 18, 9, 6, 14, p[1]);
  rect(img, 7, 21, 9, 4, p[2]);
  rect(img, 18, 21, 9, 4, p[2]);
  rect(img, 10, 11, 4, 2, p[3]);
  rect(img, 19, 11, 4, 2, p[3]);
}

function drawWeapon(img, p) {
  shadow(img);
  rect(img, 14, 20, 4, 7, p[1]);
  rect(img, 10, 17, 12, 3, p[3]);
  rect(img, 15, 6, 2, 12, p[2]);
  rect(img, 13, 8, 6, 2, p[2]);
  rect(img, 14, 5, 4, 3, p[3]);
}

function drawEquipmentIcon(img) {
  shadow(img);
  rect(img, 9, 8, 14, 12, "#5d3d12");
  rect(img, 11, 6, 10, 3, "#f4d476");
  rect(img, 8, 12, 16, 11, "#1b1a17");
  rect(img, 10, 14, 5, 7, "#d9aa42");
  rect(img, 17, 14, 5, 7, "#8fbdd9");
  rect(img, 12, 9, 8, 2, "#fff2cb");
  rect(img, 7, 23, 18, 2, "#5d3d12");
}

function shadow(img) {
  rect(img, 6, 26, 20, 3, "#00000066");
}

function rect(img, x, y, w, h, color) {
  const [r, g, b, a] = parseColor(color);
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) setPixel(img, xx, yy, r, g, b, a);
  }
}

function setPixel(img, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const index = (y * img.width + x) * 4;
  img.data[index] = r;
  img.data[index + 1] = g;
  img.data[index + 2] = b;
  img.data[index + 3] = a;
}

function parseColor(hex) {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const a = raw.length >= 8 ? parseInt(raw.slice(6, 8), 16) : 255;
  return [r, g, b, a];
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

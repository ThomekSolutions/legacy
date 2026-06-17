const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "assets", "ui", "windows");
const STONE = path.join(ROOT, "assets", "ui", "ui-stone.png");
const BUTTON = path.join(ROOT, "assets", "ui", "buttons", "button-long-normal.png");

fs.mkdirSync(OUT_DIR, { recursive: true });

const stone = decodePng(fs.readFileSync(STONE));
const button = decodePng(fs.readFileSync(BUTTON));

const assets = [
  ["window-panel.png", 192, 192, 28, 0],
  ["window-popup.png", 160, 160, 24, 1],
  ["window-sidebar.png", 192, 192, 26, 2],
];

for (const [name, width, height, border, variant] of assets) {
  const image = createImage(width, height);
  fillStone(image, stone, variant);
  drawButtonInspiredFrame(image, button, border, variant);
  fs.writeFileSync(path.join(OUT_DIR, name), encodePng(image));
}

const atlas = {
  meta: {
    source: "generated from ui-stone.png and buttons/button-long-normal.png",
    generatedBy: "tools/generate-ui-windows.js",
  },
  frames: {
    panel: { file: "window-panel.png", nineSlice: { top: 28, right: 28, bottom: 28, left: 28 } },
    popup: { file: "window-popup.png", nineSlice: { top: 24, right: 24, bottom: 24, left: 24 } },
    sidebar: { file: "window-sidebar.png", nineSlice: { top: 26, right: 26, bottom: 26, left: 26 } },
  },
};

fs.writeFileSync(path.join(OUT_DIR, "windows-atlas.json"), `${JSON.stringify(atlas, null, 2)}\n`);
console.log(`Generated ${assets.length} window assets in ${OUT_DIR}`);

function drawButtonInspiredFrame(image, buttonImage, border, variant) {
  const w = image.width;
  const h = image.height;
  const corner = Math.min(22, border);
  const topH = Math.min(16, border);
  const bottomH = Math.min(16, border);
  const leftW = Math.min(22, border);
  const rightW = Math.min(22, border);
  const bw = buttonImage.width;
  const bh = buttonImage.height;

  blitScaled(image, buttonImage, 0, 0, corner, topH, 0, 0, border, border);
  blitScaled(image, buttonImage, bw - corner, 0, corner, topH, w - border, 0, border, border);
  blitScaled(image, buttonImage, 0, bh - bottomH, corner, bottomH, 0, h - border, border, border);
  blitScaled(image, buttonImage, bw - corner, bh - bottomH, corner, bottomH, w - border, h - border, border, border);

  blitScaled(image, buttonImage, corner, 0, bw - corner * 2, topH, border, 0, w - border * 2, border);
  blitScaled(image, buttonImage, corner, bh - bottomH, bw - corner * 2, bottomH, border, h - border, w - border * 2, border);
  blitScaled(image, buttonImage, 0, topH, leftW, bh - topH - bottomH, 0, border, border, h - border * 2);
  blitScaled(image, buttonImage, bw - rightW, topH, rightW, bh - topH - bottomH, w - border, border, border, h - border * 2);

  const gold = variant === 1 ? [241, 190, 72, 255] : [204, 139, 35, 255];
  const darkGold = [89, 55, 12, 255];
  const black = [3, 3, 3, 255];
  strokeRect(image, 3, 3, w - 6, h - 6, darkGold);
  strokeRect(image, 5, 5, w - 10, h - 10, gold);
  strokeRect(image, border - 4, border - 4, w - (border - 4) * 2, h - (border - 4) * 2, black);
  strokeRect(image, border - 6, border - 6, w - (border - 6) * 2, h - (border - 6) * 2, darkGold);

  drawCornerAccent(image, 10, 10, 1, 1, gold);
  drawCornerAccent(image, w - 11, 10, -1, 1, gold);
  drawCornerAccent(image, 10, h - 11, 1, -1, gold);
  drawCornerAccent(image, w - 11, h - 11, -1, -1, gold);
}

function fillStone(image, stoneImage, variant) {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const sx = (x + variant * 31) % stoneImage.width;
      const sy = (y + variant * 17) % stoneImage.height;
      const [r, g, b, a] = getPixel(stoneImage, sx, sy);
      const shade = 0.42 + variant * 0.035;
      setPixel(image, x, y, [Math.round(r * shade), Math.round(g * shade), Math.round(b * shade), a]);
    }
  }
  const vignette = [0, 0, 0, 120];
  for (let i = 0; i < 14; i += 1) {
    strokeRect(image, i, i, image.width - i * 2, image.height - i * 2, [vignette[0], vignette[1], vignette[2], Math.max(10, vignette[3] - i * 7)]);
  }
}

function drawCornerAccent(image, x, y, sx, sy, color) {
  line(image, x, y, x + sx * 12, y, color);
  line(image, x, y, x, y + sy * 12, color);
  line(image, x + sx * 4, y + sy * 4, x + sx * 10, y + sy * 4, color);
  line(image, x + sx * 4, y + sy * 4, x + sx * 4, y + sy * 10, color);
}

function strokeRect(image, x, y, width, height, color) {
  line(image, x, y, x + width - 1, y, color);
  line(image, x, y + height - 1, x + width - 1, y + height - 1, color);
  line(image, x, y, x, y + height - 1, color);
  line(image, x + width - 1, y, x + width - 1, y + height - 1, color);
}

function line(image, x1, y1, x2, y2, color) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  let x = x1;
  let y = y1;
  while (true) {
    blendPixel(image, x, y, color);
    if (x === x2 && y === y2) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function blitScaled(target, source, sx, sy, sw, sh, dx, dy, dw, dh) {
  if (dw <= 0 || dh <= 0) return;
  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      const tx = Math.floor(dx + x);
      const ty = Math.floor(dy + y);
      const px = Math.floor(sx + (x / dw) * sw);
      const py = Math.floor(sy + (y / dh) * sh);
      blendPixel(target, tx, ty, getPixel(source, px, py));
    }
  }
}

function getPixel(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

function setPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const i = (y * image.width + x) * 4;
  image.data[i] = color[0];
  image.data[i + 1] = color[1];
  image.data[i + 2] = color[2];
  image.data[i + 3] = color[3];
}

function blendPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const i = (y * image.width + x) * 4;
  const alpha = color[3] / 255;
  const inv = 1 - alpha;
  image.data[i] = Math.round(color[0] * alpha + image.data[i] * inv);
  image.data[i + 1] = Math.round(color[1] * alpha + image.data[i + 1] * inv);
  image.data[i + 2] = Math.round(color[2] * alpha + image.data[i + 2] * inv);
  image.data[i + 3] = Math.min(255, Math.round(color[3] + image.data[i + 3] * inv));
}

function createImage(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("Invalid PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (![2, 6].includes(colorType)) throw new Error("Only RGB/RGBA PNGs are supported");
    }
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const filtered = Buffer.alloc(stride * height);
  let inOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[inOffset++];
    const row = raw.subarray(inOffset, inOffset + stride);
    const prior = y > 0 ? filtered.subarray((y - 1) * stride, y * stride) : null;
    const dest = filtered.subarray(y * stride, (y + 1) * stride);
    unfilterRow(filter, row, prior, dest, channels);
    inOffset += stride;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * channels;
      const dst = (y * width + x) * 4;
      out[dst] = filtered[src];
      out[dst + 1] = filtered[src + 1];
      out[dst + 2] = filtered[src + 2];
      out[dst + 3] = channels === 4 ? filtered[src + 3] : 255;
    }
  }
  return { width, height, data: out };
}

function unfilterRow(filter, row, prior, dest, bpp) {
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bpp ? dest[i - bpp] : 0;
    const up = prior ? prior[i] : 0;
    const upLeft = prior && i >= bpp ? prior[i - bpp] : 0;
    let value = row[i];
    if (filter === 1) value = (value + left) & 255;
    else if (filter === 2) value = (value + up) & 255;
    else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) value = (value + paeth(left, up, upLeft)) & 255;
    dest[i] = value;
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function encodePng(image) {
  const scanline = image.width * 4 + 1;
  const raw = Buffer.alloc(scanline * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * scanline] = 0;
    image.data.copy(raw, y * scanline + 1, y * image.width * 4, (y + 1) * image.width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", Buffer.concat([u32(image.width), u32(image.height), Buffer.from([8, 6, 0, 0, 0])])),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  return Buffer.concat([u32(data.length), name, data, u32(crc32(Buffer.concat([name, data])))]); 
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

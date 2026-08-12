import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const SIZE = 1024;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = SIZE * 4;
  const scanlines = Buffer.alloc((stride + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (stride + 1);
    scanlines[row] = 0;
    pixels.copy(scanlines, row + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND'),
  ]);
}

function makeCanvas(background = [0, 0, 0, 0]) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const p = i * 4;
    pixels[p] = background[0];
    pixels[p + 1] = background[1];
    pixels[p + 2] = background[2];
    pixels[p + 3] = background[3];
  }
  return pixels;
}

function makeGradientCanvas(from, to) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const t = Math.min(1, Math.max(0, (x + y) / (SIZE * 1.55)));
      const p = (y * SIZE + x) * 4;
      pixels[p] = Math.round(from[0] + (to[0] - from[0]) * t);
      pixels[p + 1] = Math.round(from[1] + (to[1] - from[1]) * t);
      pixels[p + 2] = Math.round(from[2] + (to[2] - from[2]) * t);
      pixels[p + 3] = 255;
    }
  }
  return pixels;
}

function setPixel(pixels, x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const p = (y * SIZE + x) * 4;
  pixels[p] = color[0];
  pixels[p + 1] = color[1];
  pixels[p + 2] = color[2];
  pixels[p + 3] = color[3];
}

function fillRoundedRect(pixels, x, y, width, height, radius, color) {
  const right = x + width - 1;
  const bottom = y + height - 1;
  for (let py = y; py <= bottom; py += 1) {
    for (let px = x; px <= right; px += 1) {
      const cx = px < x + radius ? x + radius : px > right - radius ? right - radius : px;
      const cy = py < y + radius ? y + radius : py > bottom - radius ? bottom - radius : py;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= radius * radius) setPixel(pixels, px, py, color);
    }
  }
}

function fillRect(pixels, x, y, width, height, color) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) setPixel(pixels, px, py, color);
  }
}

function fillCircle(pixels, cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(pixels, x, y, color);
    }
  }
}

function fillTriangle(pixels, ax, ay, bx, by, cx, cy, color) {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const w1 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area;
      const w2 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area;
      const w3 = 1 - w1 - w2;
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) setPixel(pixels, x, y, color);
    }
  }
}

function drawPdfMark(pixels, ink = [255, 255, 255, 255], ribbon = [225, 29, 72, 255]) {
  fillRoundedRect(pixels, 270, 190, 484, 620, 82, ink);
  fillTriangle(pixels, 598, 190, 754, 346, 598, 346, [224, 231, 255, 255]);
  fillRoundedRect(pixels, 330, 380, 310, 28, 14, [99, 102, 241, 255]);
  fillRoundedRect(pixels, 330, 444, 270, 24, 12, [203, 213, 225, 255]);
  fillRoundedRect(pixels, 330, 500, 300, 24, 12, [203, 213, 225, 255]);
  fillRoundedRect(pixels, 330, 556, 222, 24, 12, [203, 213, 225, 255]);
  fillRoundedRect(pixels, 318, 632, 388, 104, 32, ribbon);

  // Minimal geometric PDF monogram, readable even at small launcher sizes.
  fillRect(pixels, 370, 662, 14, 46, [255, 255, 255, 255]);
  fillRoundedRect(pixels, 384, 662, 40, 26, 10, [255, 255, 255, 255]);
  fillRoundedRect(pixels, 390, 669, 24, 12, 6, ribbon);

  fillRect(pixels, 462, 662, 14, 46, [255, 255, 255, 255]);
  fillRoundedRect(pixels, 476, 662, 38, 46, 9, [255, 255, 255, 255]);
  fillRoundedRect(pixels, 476, 672, 20, 26, 6, ribbon);

  fillRect(pixels, 552, 662, 14, 46, [255, 255, 255, 255]);
  fillRect(pixels, 566, 662, 40, 12, [255, 255, 255, 255]);
  fillRect(pixels, 566, 680, 30, 11, [255, 255, 255, 255]);
}

const iconPixels = makeGradientCanvas([15, 23, 42], [79, 70, 229]);
fillCircle(iconPixels, 790, 180, 210, [99, 102, 241, 70]);
fillCircle(iconPixels, 170, 850, 180, [14, 165, 233, 38]);
fillRoundedRect(iconPixels, 104, 104, 816, 816, 196, [17, 24, 39, 128]);
drawPdfMark(iconPixels);

const adaptivePixels = makeCanvas();
drawPdfMark(adaptivePixels);

const monochromePixels = makeCanvas();
fillRoundedRect(monochromePixels, 282, 202, 460, 596, 76, [0, 0, 0, 255]);
fillRoundedRect(monochromePixels, 326, 626, 372, 106, 30, [0, 0, 0, 255]);

const icon = encodePng(iconPixels);
const adaptive = encodePng(adaptivePixels);
const monochrome = encodePng(monochromePixels);

writeFileSync(resolve(root, 'assets', 'icon.png'), icon);
writeFileSync(resolve(root, 'assets', 'adaptive-icon.png'), adaptive);
writeFileSync(resolve(root, 'assets', 'monochrome-icon.png'), monochrome);
writeFileSync(resolve(root, 'assets', 'splash-icon.png'), adaptive);
writeFileSync(resolve(root, 'assets', 'favicon.png'), icon);

console.log(`Prepared PDF Pro brand assets (${icon.length} / ${adaptive.length} / ${monochrome.length} bytes).`);

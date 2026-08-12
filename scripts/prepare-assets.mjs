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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = SIZE * 4;
  const scanlines = Buffer.alloc((stride + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (stride + 1);
    scanlines[row] = 0; // PNG filter type 0: universally supported by Expo/Jimp
    pixels.copy(scanlines, row + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND'),
  ]);
}

function makeCanvas(background) {
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

function fillRoundedRect(pixels, x, y, width, height, radius, color) {
  const right = x + width - 1;
  const bottom = y + height - 1;
  for (let py = y; py <= bottom; py += 1) {
    for (let px = x; px <= right; px += 1) {
      const cx = px < x + radius ? x + radius : px > right - radius ? right - radius : px;
      const cy = py < y + radius ? y + radius : py > bottom - radius ? bottom - radius : py;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const p = (py * SIZE + px) * 4;
      pixels[p] = color[0];
      pixels[p + 1] = color[1];
      pixels[p + 2] = color[2];
      pixels[p + 3] = color[3];
    }
  }
}

function fillRect(pixels, x, y, width, height, color) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const p = (py * SIZE + px) * 4;
      pixels[p] = color[0];
      pixels[p + 1] = color[1];
      pixels[p + 2] = color[2];
      pixels[p + 3] = color[3];
    }
  }
}

function drawDocument(pixels) {
  fillRoundedRect(pixels, 282, 220, 460, 584, 74, [255, 255, 255, 255]);
  fillRoundedRect(pixels, 575, 220, 167, 167, 48, [99, 102, 241, 255]);
  fillRect(pixels, 350, 436, 325, 34, [99, 102, 241, 255]);
  fillRoundedRect(pixels, 350, 514, 270, 28, 14, [203, 213, 225, 255]);
  fillRoundedRect(pixels, 350, 578, 315, 28, 14, [203, 213, 225, 255]);
  fillRoundedRect(pixels, 350, 642, 220, 28, 14, [203, 213, 225, 255]);
  fillRoundedRect(pixels, 606, 676, 82, 82, 28, [17, 24, 39, 255]);
  fillRect(pixels, 628, 715, 38, 8, [255, 255, 255, 255]);
  fillRect(pixels, 643, 700, 8, 38, [255, 255, 255, 255]);
}

const iconPixels = makeCanvas([17, 24, 39, 255]);
fillRoundedRect(iconPixels, 110, 110, 804, 804, 190, [31, 41, 67, 255]);
fillRoundedRect(iconPixels, 180, 180, 664, 664, 160, [67, 56, 202, 255]);
drawDocument(iconPixels);

const adaptivePixels = makeCanvas([0, 0, 0, 0]);
drawDocument(adaptivePixels);

const icon = encodePng(iconPixels);
const adaptive = encodePng(adaptivePixels);
writeFileSync(resolve(root, 'assets', 'icon.png'), icon);
writeFileSync(resolve(root, 'assets', 'adaptive-icon.png'), adaptive);

console.log(`Prepared standards-compliant launcher assets (${icon.length} / ${adaptive.length} bytes).`);

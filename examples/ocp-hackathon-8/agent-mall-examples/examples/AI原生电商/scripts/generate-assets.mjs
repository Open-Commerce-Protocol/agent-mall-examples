import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const width = 640;
const height = 400;
const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
mkdirSync(outputDir, { recursive: true });

const themes = [
  ['nova-air.png', [224, 238, 232], [31, 117, 82]],
  ['forge-x16.png', [225, 227, 235], [65, 72, 109]],
  ['studio-pro.png', [238, 229, 222], [151, 73, 64]],
  ['campus-book.png', [231, 237, 222], [109, 132, 62]],
  ['summit-work.png', [222, 232, 235], [49, 93, 105]],
  ['nomad-flex.png', [235, 226, 239], [111, 70, 126]],
  ['default-laptop.png', [229, 234, 231], [58, 94, 81]],
];

for (const [filename, background, accent] of themes) writeFileSync(join(outputDir, filename), createLaptopPng(background, accent));

function createLaptopPng(background, accent) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const light = Math.round((x / width) * 10 + (1 - y / height) * 5);
      setPixel(pixels, x, y, background.map((value) => Math.min(255, value + light)));
    }
  }
  fillRect(pixels, 135, 62, 370, 245, [31, 36, 35]);
  fillRect(pixels, 148, 75, 344, 218, [242, 246, 244]);
  for (let y = 75; y < 293; y += 1) {
    const ratio = (y - 75) / 218;
    const color = accent.map((value) => Math.round(value + (238 - value) * ratio));
    fillRect(pixels, 148, y, 344, 1, color);
  }
  fillRect(pixels, 205, 122, 230, 9, [255, 255, 255]);
  fillRect(pixels, 205, 143, 168, 6, [255, 255, 255]);
  fillRect(pixels, 205, 178, 96, 53, [255, 255, 255]);
  fillRect(pixels, 312, 178, 123, 53, [255, 255, 255]);
  fillRect(pixels, 102, 307, 436, 18, [94, 103, 100]);
  fillRect(pixels, 74, 325, 492, 13, [56, 63, 61]);
  fillRect(pixels, 260, 325, 120, 5, [126, 136, 132]);
  return encodePng(pixels);
}

function setPixel(buffer, x, y, color) {
  const index = (y * width + x) * 4;
  buffer[index] = color[0]; buffer[index + 1] = color[1]; buffer[index + 2] = color[2]; buffer[index + 3] = 255;
}

function fillRect(buffer, x, y, rectWidth, rectHeight, color) {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) setPixel(buffer, column, row, color);
  }
}

function encodePng(pixels) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1);
    scanlines[target] = 0;
    pixels.copy(scanlines, target + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

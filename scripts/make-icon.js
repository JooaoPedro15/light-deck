'use strict';
// Gera build/icon.png (512x512). O electron-builder converte esse PNG
// em .ico (Windows) e .icns (Mac) na hora de montar o instalador.
// Uso: npm run icon

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { drawIcon } = require('../src/main/icon-pixels');

const SIZE = 512;

// Um PNG é uma sequência de blocos: tamanho, tipo, dados e um CRC para detectar corrupção.
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(rgba, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); // largura
  header.writeUInt32BE(size, 4); // altura
  header[8] = 8; // 8 bits por canal
  header[9] = 6; // tipo 6 = RGBA
  // Cada linha começa com 1 byte de "filtro" (0 = nenhum).
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(drawIcon(SIZE), SIZE));
console.log(`icone gerado: ${out}`);

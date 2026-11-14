'use strict';
// Ícone do app desenhado em código (duas cartas sobre um quadrado roxo),
// assim não dependemos de arquivo .ico/.icns para rodar em Windows e Mac.

const { nativeImage } = require('electron');

function insideRounded(px, py, x0, y0, x1, y1, radius) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.min(Math.max(px, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(py, y0 + radius), y1 - radius);
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
}

function appIcon(size = 32, scaleFactor = 1) {
  const pixels = Buffer.alloc(size * size * 4); // tudo transparente
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let color = null;
      if (insideRounded(px, py, 1, 1, size - 1, size - 1, size * 0.22)) color = [0x7c, 0x5c, 0xff];
      if (insideRounded(px, py, size * 0.4, size * 0.2, size * 0.8, size * 0.68, size * 0.07)) color = [0xc9, 0xbd, 0xff];
      if (insideRounded(px, py, size * 0.2, size * 0.32, size * 0.6, size * 0.8, size * 0.07)) color = [0xff, 0xff, 0xff];
      if (!color) continue;
      const i = (y * size + x) * 4;
      pixels[i] = color[2]; // o bitmap é BGRA
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[0];
      pixels[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor });
}

module.exports = { appIcon };

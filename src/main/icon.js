'use strict';
// Ícone do app desenhado em código, usado na janela e na bandeja.

const { nativeImage } = require('electron');
const { drawIcon } = require('./icon-pixels');

function appIcon(size = 32, scaleFactor = 1) {
  const pixels = drawIcon(size);
  // O Electron espera BGRA: troca vermelho e azul de lugar.
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    pixels[i] = pixels[i + 2];
    pixels[i + 2] = red;
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size, scaleFactor });
}

module.exports = { appIcon };

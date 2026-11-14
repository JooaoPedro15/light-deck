'use strict';
// Configuração do app: grupos, contas (slots) e preferências, salvos em um JSON.
// Este arquivo não usa nada do Electron de propósito, para poder ser testado com `node --test`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VIEW_MODES = ['focus', 'grid'];

function newId() {
  return crypto.randomUUID();
}

// Aceita só http/https. Devolve a URL normalizada ou null se for inválida.
function cleanUrl(input) {
  let text = String(input == null ? '' : input).trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanName(input, fallback) {
  const text = String(input == null ? '' : input).trim().slice(0, 60);
  return text || fallback;
}

function isId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value);
}

// Recebe qualquer coisa (arquivo corrompido, versão antiga...) e devolve uma config válida.
function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};

  const groups = [];
  const groupIds = new Set();
  for (const g of Array.isArray(src.groups) ? src.groups : []) {
    if (!g || !isId(g.id) || groupIds.has(g.id)) continue;
    groupIds.add(g.id);
    groups.push({ id: g.id, name: cleanName(g.name, 'Grupo') });
  }
  if (!groups.length) {
    const id = newId();
    groupIds.add(id);
    groups.push({ id, name: 'Meus jogos' });
  }

  const slots = [];
  const slotIds = new Set();
  for (const s of Array.isArray(src.slots) ? src.slots : []) {
    if (!s || !isId(s.id) || slotIds.has(s.id)) continue;
    const url = cleanUrl(s.url);
    if (!url) continue;
    slotIds.add(s.id);
    slots.push({
      id: s.id,
      groupId: groupIds.has(s.groupId) ? s.groupId : groups[0].id,
      name: cleanName(s.name, new URL(url).hostname),
      url,
      muted: !!s.muted,
      eco: s.eco !== false, // economia ligada por padrão
      running: !!s.running,
    });
  }

  const ui = src.ui && typeof src.ui === 'object' ? src.ui : {};
  const settings = src.settings && typeof src.settings === 'object' ? src.settings : {};
  const win = src.window && typeof src.window === 'object' ? src.window : {};
  const num = (v, min, fallback) => (Number.isFinite(v) && v >= min ? Math.round(v) : fallback);

  return {
    version: 1,
    groups,
    slots,
    ui: {
      viewMode: VIEW_MODES.includes(ui.viewMode) ? ui.viewMode : 'focus',
      activeSlotId: slotIds.has(ui.activeSlotId) ? ui.activeSlotId : (slots[0] ? slots[0].id : null),
    },
    settings: {
      closeToTray: settings.closeToTray !== false,
      openAtLogin: !!settings.openAtLogin,
      muteAll: !!settings.muteAll,
    },
    window: {
      width: num(win.width, 720, 1280),
      height: num(win.height, 480, 800),
      x: Number.isFinite(win.x) ? Math.round(win.x) : null,
      y: Number.isFinite(win.y) ? Math.round(win.y) : null,
      maximized: !!win.maximized,
    },
  };
}

// Guarda a config na memória e grava no disco com atraso (debounce),
// para não escrever o arquivo a cada clique.
class Store {
  constructor(file) {
    this.file = file;
    this.data = normalize(null);
    this.timer = null;
  }

  load() {
    try {
      this.data = normalize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      this.data = normalize(null);
    }
    return this.data;
  }

  get() {
    return this.data;
  }

  // Aplica uma alteração e agenda a gravação.
  update(change) {
    change(this.data);
    this.data = normalize(this.data);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  // Grava agora. Escreve em um arquivo temporário e renomeia, para nunca deixar o JSON pela metade.
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Falha ao salvar a configuração:', err.message);
    }
  }
}

module.exports = { Store, normalize, cleanUrl, cleanName, newId, isId };

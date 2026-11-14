'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, normalize, cleanUrl } = require('../src/main/config');

test('cleanUrl completa o https e aceita http/https', () => {
  assert.equal(cleanUrl('pokeidle.io'), 'https://pokeidle.io/');
  assert.equal(cleanUrl('  http://exemplo.com/jogo  '), 'http://exemplo.com/jogo');
  assert.equal(cleanUrl('localhost:3000'), 'https://localhost:3000/');
});

test('cleanUrl recusa vazio e esquemas perigosos', () => {
  assert.equal(cleanUrl(''), null);
  assert.equal(cleanUrl(null), null);
  assert.equal(cleanUrl('javascript:alert(1)'), null);
  assert.equal(cleanUrl('file:///C:/Windows/win.ini'), null);
  assert.equal(cleanUrl('chrome://settings'), null);
});

test('normalize cria um grupo padrão quando não há nada', () => {
  const cfg = normalize(null);
  assert.equal(cfg.groups.length, 1);
  assert.deepEqual(cfg.slots, []);
  assert.equal(cfg.ui.viewMode, 'focus');
  assert.equal(cfg.ui.activeSlotId, null);
  assert.equal(cfg.settings.closeToTray, true);
});

test('normalize descarta contas inválidas e conserta o grupo', () => {
  const cfg = normalize({
    groups: [{ id: 'g1', name: 'Poke' }],
    slots: [
      { id: 's1', groupId: 'g1', name: 'Conta 1', url: 'pokeidle.io' },
      { id: 's2', groupId: 'nao-existe', url: 'https://exemplo.com' },
      { id: 's3', groupId: 'g1', url: 'javascript:alert(1)' },
      { id: 's1', groupId: 'g1', url: 'https://duplicado.com' },
    ],
    ui: { activeSlotId: 'sumiu', viewMode: 'qualquer' },
  });
  assert.deepEqual(cfg.slots.map((s) => s.id), ['s1', 's2']);
  assert.equal(cfg.slots[1].groupId, 'g1');
  assert.equal(cfg.slots[1].name, 'exemplo.com');
  assert.equal(cfg.slots[0].eco, true);
  assert.equal(cfg.ui.activeSlotId, 's1');
  assert.equal(cfg.ui.viewMode, 'focus');
});

test('Store grava e lê de volta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-deck-'));
  const file = path.join(dir, 'config.json');
  const a = new Store(file);
  a.load();
  a.update((c) => {
    c.slots.push({ id: 'abc', groupId: c.groups[0].id, name: 'Teste', url: 'https://exemplo.com' });
  });
  a.flush();
  const b = new Store(file);
  b.load();
  assert.equal(b.get().slots[0].name, 'Teste');
  fs.rmSync(dir, { recursive: true, force: true });
});

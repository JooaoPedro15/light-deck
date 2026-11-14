'use strict';
// Processo principal: cria a janela, a bandeja e atende os pedidos da interface.

const { app, BrowserWindow, ipcMain, Menu, Tray, dialog, session } = require('electron');
const os = require('os');
const path = require('path');
const { Store, cleanUrl, cleanName, newId, isId } = require('./config');
const { Slots, partitionOf } = require('./slots');
const { appIcon } = require('./icon');

const START_HIDDEN = process.argv.includes('--hidden');
const IS_MAC = process.platform === 'darwin';

// Pasta de dados alternativa (útil para testar sem mexer nas contas de verdade).
if (process.env.LIGHT_DECK_DATA) app.setPath('userData', path.resolve(process.env.LIGHT_DECK_DATA));

// Por padrão o Chromium, depois de 5 min com a página oculta, passa a acordar os timers
// só 1 vez por MINUTO. Para jogo idle isso é demais; desligando, o limite fica em ~1 por segundo.
app.commandLine.appendSwitch('disable-features', 'IntensiveWakeUpThrottling');

let win = null;
let tray = null;
let store = null;
let slots = null;
let quitting = false;
let pushTimer = null;
let metricsTimer = null;

function cfg() {
  return store.get();
}

function findSlot(id) {
  return cfg().slots.find((s) => s.id === id) || null;
}

function findGroup(id) {
  return cfg().groups.find((g) => g.id === id) || null;
}

function snapshot() {
  const c = cfg();
  return { groups: c.groups, slots: c.slots, ui: c.ui, settings: c.settings, runtime: slots.view() };
}

// Junta várias mudanças seguidas em um único envio para a interface.
function push() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
    refreshTray();
  }, 50);
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function quit() {
  quitting = true;
  app.quit();
}

/* ---------- ações sobre contas e grupos ---------- */

function setRunning(id, running) {
  if (!findSlot(id)) return;
  store.update((c) => {
    c.slots.find((s) => s.id === id).running = running;
  });
  if (running) slots.start(id);
  else slots.stop(id);
}

async function confirmBox(message, detail, button) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [button, 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    message,
    detail,
  });
  return response === 0;
}

function eraseSlot(id) {
  slots.stop(id);
  // Apaga cookies, login e cache daquela conta.
  session.fromPartition(partitionOf(id)).clearStorageData().catch(() => {});
}

async function removeSlot(id) {
  const slot = findSlot(id);
  if (!slot) return;
  const ok = await confirmBox(`Remover "${slot.name}"?`, 'O login e os dados salvos desta conta serão apagados.', 'Remover');
  if (!ok) return;
  eraseSlot(id);
  store.update((c) => {
    c.slots = c.slots.filter((s) => s.id !== id);
  });
}

async function removeGroup(id) {
  const group = findGroup(id);
  if (!group) return;
  if (cfg().groups.length === 1) {
    await dialog.showMessageBox(win, { type: 'info', message: 'Precisa existir pelo menos um grupo.' });
    return;
  }
  const members = cfg().slots.filter((s) => s.groupId === id);
  const detail = members.length
    ? `As ${members.length} conta(s) do grupo e seus logins serão apagados.`
    : 'O grupo está vazio.';
  if (!(await confirmBox(`Remover o grupo "${group.name}"?`, detail, 'Remover'))) return;
  for (const s of members) eraseSlot(s.id);
  store.update((c) => {
    c.slots = c.slots.filter((s) => s.groupId !== id);
    c.groups = c.groups.filter((g) => g.id !== id);
  });
}

const actions = {
  addGroup({ name }) {
    store.update((c) => c.groups.push({ id: newId(), name: cleanName(name, 'Grupo') }));
  },
  renameGroup({ id, name }) {
    if (!findGroup(id)) return;
    store.update((c) => {
      c.groups.find((g) => g.id === id).name = cleanName(name, 'Grupo');
    });
  },
  addSlot({ groupId, name, url }) {
    const clean = cleanUrl(url);
    if (!clean) return { error: 'Endereço inválido. Use algo como https://jogo.com' };
    const id = newId();
    store.update((c) => {
      c.slots.push({
        id,
        groupId: findGroup(groupId) ? groupId : c.groups[0].id,
        name: cleanName(name, new URL(clean).hostname),
        url: clean,
        running: true,
      });
      c.ui.activeSlotId = id;
    });
    slots.start(id);
  },
  editSlot({ id, groupId, name, url }) {
    const slot = findSlot(id);
    if (!slot) return;
    const clean = cleanUrl(url);
    if (!clean) return { error: 'Endereço inválido. Use algo como https://jogo.com' };
    const urlChanged = clean !== slot.url;
    store.update((c) => {
      const s = c.slots.find((one) => one.id === id);
      s.name = cleanName(name, new URL(clean).hostname);
      s.url = clean;
      if (findGroup(groupId)) s.groupId = groupId;
    });
    if (urlChanged) slots.navigate(id);
  },
  // Clicar numa conta: ela vira a conta em foco e é iniciada se estiver parada.
  activateSlot({ id }) {
    if (!findSlot(id)) return;
    store.update((c) => {
      c.ui.activeSlotId = id;
    });
    if (!slots.isRunning(id)) setRunning(id, true);
  },
  startSlot: ({ id }) => setRunning(id, true),
  stopSlot: ({ id }) => setRunning(id, false),
  reloadSlot: ({ id }) => slots.reload(id),
  toggleMute({ id }) {
    if (!findSlot(id)) return;
    store.update((c) => {
      const s = c.slots.find((one) => one.id === id);
      s.muted = !s.muted;
    });
    slots.applyMute(id);
  },
  setViewMode({ viewMode }) {
    store.update((c) => {
      c.ui.viewMode = viewMode;
    });
  },
  setSettings(patch) {
    store.update((c) => {
      for (const key of ['closeToTray', 'openAtLogin', 'muteAll']) {
        if (typeof patch[key] === 'boolean') c.settings[key] = patch[key];
      }
    });
    slots.applyMute();
    applyLoginItem();
  },
  layout({ rects }) {
    slots.setLayout(rects);
    return { silent: true };
  },
  slotMenu: ({ id }) => popupSlotMenu(id),
  groupMenu: ({ id }) => popupGroupMenu(id),
};

/* ---------- menus nativos ---------- */
// Menus nativos aparecem por cima das páginas dos jogos (um menu em HTML ficaria escondido atrás delas).

function popupSlotMenu(id) {
  const slot = findSlot(id);
  if (!slot) return;
  const running = slots.isRunning(id);
  const run = (fn) => () => {
    fn();
    push();
  };
  Menu.buildFromTemplate([
    running
      ? { label: 'Parar', click: run(() => setRunning(id, false)) }
      : { label: 'Iniciar', click: run(() => setRunning(id, true)) },
    { label: 'Recarregar', enabled: running, click: () => slots.reload(id) },
    { type: 'separator' },
    { label: 'Silenciar', type: 'checkbox', checked: slot.muted, click: run(() => actions.toggleMute({ id })) },
    {
      label: 'Economizar quando oculta',
      type: 'checkbox',
      checked: slot.eco,
      click: run(() => {
        store.update((c) => {
          const s = c.slots.find((one) => one.id === id);
          s.eco = !s.eco;
        });
        slots.applyEco(id);
      }),
    },
    { type: 'separator' },
    { label: 'Editar…', click: () => win.webContents.send('command', { type: 'editSlot', id }) },
    { label: 'Remover…', click: () => removeSlot(id).then(push) },
  ]).popup({ window: win });
}

function popupGroupMenu(id) {
  const group = findGroup(id);
  if (!group) return;
  const members = cfg().slots.filter((s) => s.groupId === id);
  const each = (running) => () => {
    for (const s of members) setRunning(s.id, running);
    push();
  };
  Menu.buildFromTemplate([
    { label: 'Adicionar conta…', click: () => win.webContents.send('command', { type: 'addSlot', groupId: id }) },
    { type: 'separator' },
    { label: 'Iniciar todas', enabled: members.length > 0, click: each(true) },
    { label: 'Parar todas', enabled: members.length > 0, click: each(false) },
    { type: 'separator' },
    { label: 'Renomear…', click: () => win.webContents.send('command', { type: 'renameGroup', id }) },
    { label: 'Remover…', click: () => removeGroup(id).then(push) },
  ]).popup({ window: win });
}

/* ---------- bandeja e inicialização com o sistema ---------- */

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  const running = Object.keys(slots.view()).length;
  tray.setToolTip(`Light Deck — ${running} conta(s) rodando`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mostrar', click: showWindow },
      {
        label: 'Silenciar tudo',
        type: 'checkbox',
        checked: cfg().settings.muteAll,
        click: (item) => {
          actions.setSettings({ muteAll: item.checked });
          push();
        },
      },
      { type: 'separator' },
      { label: 'Sair', click: quit },
    ]),
  );
}

function createTray() {
  tray = new Tray(appIcon(32, 2));
  tray.on('click', showWindow);
  refreshTray();
}

function applyLoginItem() {
  if (!app.isPackaged) return; // em desenvolvimento registraria o electron.exe, não o app
  app.setLoginItemSettings({ openAtLogin: cfg().settings.openAtLogin, args: ['--hidden'] });
}

/* ---------- medidor de CPU e memória ---------- */
// Só mede com a janela na tela: medir também custa um pouquinho, e ninguém está olhando na bandeja.

function sampleMetrics() {
  if (!win || win.isDestroyed()) return;
  const cores = os.cpus().length || 1;
  const byPid = new Map();
  let cpu = 0;
  let memKb = 0;
  for (const proc of app.getAppMetrics()) {
    cpu += proc.cpu.percentCPUUsage; // 100 = um núcleo inteiro
    memKb += proc.memory.workingSetSize;
    byPid.set(proc.pid, proc);
  }
  const perSlot = {};
  for (const [id, pid] of slots.pids()) {
    const proc = byPid.get(pid);
    if (proc) perSlot[id] = { cpu: proc.cpu.percentCPUUsage / cores, memMb: proc.memory.workingSetSize / 1024 };
  }
  // Dividir pelos núcleos dá o mesmo número que o Gerenciador de Tarefas mostra.
  win.webContents.send('metrics', { cpu: cpu / cores, memMb: memKb / 1024, slots: perSlot });
}

function setMetering(on) {
  clearInterval(metricsTimer);
  metricsTimer = null;
  if (!on) return;
  app.getAppMetrics(); // zera o contador: a próxima leitura mede só o intervalo
  metricsTimer = setInterval(sampleMetrics, 2000);
}

function setHostVisible(visible) {
  slots.setHostVisible(visible);
  setMetering(visible);
}

/* ---------- janela ---------- */

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getNormalBounds();
  store.update((c) => {
    c.window = { ...bounds, maximized: win.isMaximized() };
  });
}

function createWindow() {
  const saved = cfg().window;
  win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x !== null && saved.y !== null ? { x: saved.x, y: saved.y } : {}),
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Light Deck',
    icon: appIcon(64),
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'shell.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  if (!IS_MAC) win.removeMenu(); // no Mac o menu fica: é ele que dá Cmd+C, Cmd+V, Cmd+Q

  slots = new Slots({
    win,
    getSlot: findSlot,
    isMuted: (slot) => slot.muted || cfg().settings.muteAll,
    onChange: push,
  });

  // A interface nunca deve navegar para fora do próprio arquivo.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('show', () => setHostVisible(true));
  win.on('restore', () => setHostVisible(true));
  win.on('hide', () => setHostVisible(false));
  win.on('minimize', () => setHostVisible(false));

  win.on('close', (event) => {
    saveWindowState();
    if (!quitting && cfg().settings.closeToTray) {
      event.preventDefault();
      win.hide(); // os jogos continuam rodando, só que sem desenhar nada
    }
  });
  win.on('closed', () => {
    setMetering(false);
    win = null;
  });

  win.once('ready-to-show', () => {
    if (saved.maximized) win.maximize();
    if (!START_HIDDEN) win.show();
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Reabre as contas que estavam rodando da última vez.
  for (const slot of cfg().slots) if (slot.running) slots.start(slot.id);
}

/* ---------- comunicação com a interface ---------- */

function registerIpc() {
  const fromShell = (event) => win && !win.isDestroyed() && event.sender === win.webContents;

  ipcMain.handle('state:get', (event) => (fromShell(event) ? snapshot() : null));

  ipcMain.handle('action', async (event, type, payload) => {
    if (!fromShell(event)) return { error: 'origem inválida' };
    const handler = Object.hasOwn(actions, type) ? actions[type] : null;
    if (!handler) return { error: 'ação desconhecida' };
    const data = payload && typeof payload === 'object' ? payload : {};
    if ('id' in data && !isId(data.id)) return { error: 'id inválido' };
    const result = (await handler(data)) || {};
    if (!result.silent) push();
    return result.error ? { error: result.error } : { ok: true };
  });
}

function main() {
  // Só uma cópia do app por vez: abrir de novo apenas mostra a janela existente.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    store = new Store(path.join(app.getPath('userData'), 'config.json'));
    store.load();
    registerIpc();
    createWindow();
    createTray();
    applyLoginItem();
    app.on('activate', showWindow); // clique no ícone do Dock (Mac)
  });

  app.on('before-quit', () => {
    quitting = true;
    if (store) {
      saveWindowState();
      store.flush();
    }
  });

  app.on('window-all-closed', () => {
    if (!IS_MAC) app.quit();
  });
}

main();

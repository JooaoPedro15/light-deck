'use strict';
// Cada conta (slot) em execução é uma WebContentsView: uma "aba" do Chromium
// colada dentro da janela principal, com a própria sessão (cookies, login, cache).
//
// É aqui que mora a economia de CPU/GPU:
// - conta fora da tela  -> view invisível -> o Chromium para de desenhar (zero GPU)
//   e segura os timers da página em ~1 por segundo;
// - conta parada        -> view destruída -> zero CPU e memória devolvida.

const { WebContentsView, session } = require('electron');

const VIEW_BACKGROUND = '#0f1117';
// Permissões que as páginas dos jogos podem usar sem perguntar. O resto é negado
// (câmera, microfone, localização, dispositivos USB...).
const ALLOWED_PERMISSIONS = new Set([
  'fullscreen',
  'pointerLock',
  'clipboard-sanitized-write',
  'notifications',
  'storage-access',
  'top-level-storage-access',
]);
// Depois de carregar, a página roda em velocidade total por este tempo antes da economia ligar.
// Verificações feitas no carregamento (ex.: "não sou um robô") têm prazo e falham com timers lentos.
const WARMUP_MS = 45000;

// "persist:" faz a sessão ficar gravada em disco (o login sobrevive a fechar o app).
function partitionOf(slotId) {
  return `persist:slot-${slotId}`;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url));
}

class Slots {
  constructor({ win, getSlot, isMuted, onChange }) {
    this.win = win;
    this.getSlot = getSlot;
    this.isMuted = isMuted;
    this.onChange = onChange;
    this.runtimes = new Map(); // id -> { view, loading, crashed }
    this.rects = new Map(); // id -> retângulo onde a conta aparece na janela
    this.hostVisible = false; // a janela principal está na tela?
    this.prepared = new Set(); // sessões já configuradas
  }

  isRunning(id) {
    return this.runtimes.has(id);
  }

  // Resumo do estado para a interface.
  view() {
    const out = {};
    for (const [id, rt] of this.runtimes) out[id] = { loading: rt.loading, crashed: rt.crashed };
    return out;
  }

  // id da conta -> PID do processo que roda a página (para o medidor de CPU).
  pids() {
    const out = new Map();
    for (const [id, rt] of this.runtimes) {
      if (!rt.view.webContents.isDestroyed()) out.set(id, rt.view.webContents.getOSProcessId());
    }
    return out;
  }

  prepareSession(partition) {
    if (this.prepared.has(partition)) return;
    this.prepared.add(partition);
    const ses = session.fromPartition(partition);
    // Tira "Electron/x" e o nome do app do user agent: alguns sites recusam login quando veem isso.
    ses.setUserAgent(
      ses.getUserAgent()
        .replace(/\sElectron\/\S+/, '')
        .replace(/(\(KHTML, like Gecko\)) .*?(Chrome\/)/, '$1 $2'),
    );
    ses.setPermissionRequestHandler((_wc, permission, done, details) => {
      // Notificação só para a página principal, nunca para anúncios dentro dela.
      if (permission === 'notifications' && details && details.isMainFrame === false) return done(false);
      return done(ALLOWED_PERMISSIONS.has(permission));
    });
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  }

  start(id) {
    const slot = this.getSlot(id);
    if (!slot || this.runtimes.has(id) || this.win.isDestroyed()) return;

    const partition = partitionOf(id);
    this.prepareSession(partition);

    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        // false = velocidade total mesmo oculta. Começa assim (aquecimento) e a economia
        // é ligada depois por applyEco().
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor(VIEW_BACKGROUND);
    view.setVisible(false);
    // Tamanho inicial razoável: sem isso a página nasceria 0x0 e alguns jogos se perdem no layout.
    view.setBounds({ x: 0, y: 0, width: 1024, height: 640 });
    this.win.contentView.addChildView(view);

    const rt = { view, loading: true, crashed: false, warming: true, warmTimer: null };
    this.runtimes.set(id, rt);

    const wc = view.webContents;
    wc.setAudioMuted(this.isMuted(slot));

    // Janelas abertas pela página (ex.: login com Google) só se forem http/https,
    // e sempre isoladas, sem acesso ao Node.
    wc.setWindowOpenHandler(({ url }) => {
      if (!isHttpUrl(url)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: VIEW_BACKGROUND,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
        },
      };
    });
    wc.on('will-navigate', (event, url) => {
      if (!isHttpUrl(url)) event.preventDefault();
    });

    const setState = (patch) => {
      if (this.runtimes.get(id) !== rt) return;
      Object.assign(rt, patch);
      this.onChange();
    };
    // Aquecimento: a cada carregamento da página principal, velocidade total;
    // WARMUP_MS depois de terminar, a economia volta.
    const coolDown = () => {
      clearTimeout(rt.warmTimer);
      rt.warmTimer = setTimeout(() => {
        rt.warming = false;
        this.applyEco(id);
      }, WARMUP_MS);
    };
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      clearTimeout(rt.warmTimer);
      rt.warming = true;
      this.applyEco(id);
    });
    wc.on('did-finish-load', coolDown);
    wc.on('did-fail-load', (_event, _code, _text, _url, isMainFrame) => {
      if (isMainFrame) coolDown();
    });

    wc.on('did-start-loading', () => setState({ loading: true }));
    wc.on('did-stop-loading', () => setState({ loading: false, crashed: false }));
    wc.on('render-process-gone', () => setState({ loading: false, crashed: true }));

    wc.loadURL(slot.url).catch(() => {}); // erro de rede aparece na própria página
    this.refresh();
    this.onChange();
  }

  stop(id) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    clearTimeout(rt.warmTimer);
    this.runtimes.delete(id);
    this.rects.delete(id);
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(rt.view);
    if (!rt.view.webContents.isDestroyed()) rt.view.webContents.close();
    this.onChange();
  }

  stopAll() {
    for (const id of [...this.runtimes.keys()]) this.stop(id);
  }

  reload(id) {
    const rt = this.runtimes.get(id);
    if (rt && !rt.view.webContents.isDestroyed()) rt.view.webContents.reload();
  }

  // Volta para o endereço cadastrado (usado quando o usuário edita a URL).
  navigate(id) {
    const rt = this.runtimes.get(id);
    const slot = this.getSlot(id);
    if (rt && slot && !rt.view.webContents.isDestroyed()) rt.view.webContents.loadURL(slot.url).catch(() => {});
  }

  applyMute(id) {
    const ids = id ? [id] : [...this.runtimes.keys()];
    for (const one of ids) {
      const rt = this.runtimes.get(one);
      const slot = this.getSlot(one);
      if (rt && slot && !rt.view.webContents.isDestroyed()) rt.view.webContents.setAudioMuted(this.isMuted(slot));
    }
  }

  applyEco(id) {
    const rt = this.runtimes.get(id);
    const slot = this.getSlot(id);
    if (!rt || !slot || rt.view.webContents.isDestroyed()) return;
    // Só economiza se a conta pede economia e o aquecimento já acabou.
    rt.view.webContents.setBackgroundThrottling(slot.eco && !rt.warming);
  }

  // A interface manda onde cada conta visível deve ficar. Quem não veio na lista fica oculto.
  setLayout(list) {
    const next = new Map();
    for (const item of Array.isArray(list) ? list.slice(0, 64) : []) {
      if (!item || !this.runtimes.has(item.id)) continue;
      const [x, y, width, height] = [item.x, item.y, item.width, item.height].map((n) => Math.round(Number(n)));
      if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) continue;
      next.set(item.id, { x, y, width, height });
    }
    this.rects = next;
    this.refresh();
  }

  // Janela minimizada ou na bandeja: nada precisa ser desenhado.
  setHostVisible(visible) {
    this.hostVisible = !!visible;
    this.refresh();
  }

  refresh() {
    for (const [id, rt] of this.runtimes) {
      const rect = this.hostVisible ? this.rects.get(id) : null;
      if (rect) {
        rt.view.setBounds(rect);
        rt.view.setVisible(true);
      } else {
        rt.view.setVisible(false);
      }
    }
  }
}

module.exports = { Slots, partitionOf, isHttpUrl };

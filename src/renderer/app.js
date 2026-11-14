'use strict';
// Interface do Light Deck. Ela não guarda dados: recebe o estado do processo principal,
// desenha a tela e avisa onde cada jogo deve aparecer.
// De propósito não há animações nem timers aqui: interface parada = zero CPU.

// `deck` é um global criado pelo preload (src/preload/shell.js).
const $ = (selector) => document.querySelector(selector);

let state = null;
let metrics = null;
let layoutFrame = 0;
let lastLayout = '';

// Cria um elemento. Todo texto entra por textContent, nunca por innerHTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'data') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter(Boolean));
  return node;
}

function activeSlot() {
  return state.slots.find((s) => s.id === state.ui.activeSlotId) || null;
}

function isRunning(id) {
  return Object.hasOwn(state.runtime, id);
}

// Contas que aparecem na área principal.
function visibleSlots() {
  const active = activeSlot();
  if (!active) return [];
  if (state.ui.viewMode === 'focus') return [active];
  const running = state.slots.filter((s) => s.groupId === active.groupId && isRunning(s.id));
  return running.length ? running : [active];
}

/* ---------- desenho ---------- */

function renderSidebar() {
  const nav = $('#groups');
  nav.replaceChildren();
  for (const group of state.groups) {
    nav.append(
      el('div', { class: 'group-head' },
        el('span', { text: group.name }),
        el('button', { type: 'button', title: 'Adicionar conta neste grupo', text: '+', onclick: () => openSlotDialog({ groupId: group.id }) }),
        el('button', { type: 'button', title: 'Opções do grupo', text: '⋯', onclick: () => deck.action('groupMenu', { id: group.id }) }),
      ),
    );
    const members = state.slots.filter((s) => s.groupId === group.id);
    if (!members.length) nav.append(el('div', { class: 'empty-note', text: 'Nenhuma conta.' }));
    for (const slot of members) {
      const rt = state.runtime[slot.id];
      const status = !rt ? '' : rt.crashed ? 'crashed' : rt.loading ? 'loading' : 'running';
      const muted = slot.muted || state.settings.muteAll;
      nav.append(
        el('button', {
          type: 'button',
          class: `slot${slot.id === state.ui.activeSlotId ? ' active' : ''}`,
          title: `${slot.name}\n${slot.url}\nBotão direito: opções`,
          onclick: () => deck.action('activateSlot', { id: slot.id }),
          oncontextmenu: (event) => {
            event.preventDefault();
            deck.action('slotMenu', { id: slot.id });
          },
        },
          el('span', { class: `dot ${status}` }),
          el('span', { class: 'name', text: slot.name }),
          rt ? el('span', { class: 'tag cpu', title: 'CPU usada por esta conta', data: { cpuId: slot.id } }) : null,
          muted && rt ? el('span', { class: 'tag', text: 'mudo' }) : null,
          !slot.eco ? el('span', { class: 'tag', title: 'Economia desligada para esta conta', text: '100%' }) : null,
        ),
      );
    }
  }
  $('#btn-mute-all').classList.toggle('active', state.settings.muteAll);
  $('#btn-mute-all').textContent = state.settings.muteAll ? 'Mudo' : 'Som';
}

function renderStage() {
  const stage = $('#stage');
  const shown = visibleSlots();
  const active = activeSlot();

  $('#title').textContent = active ? `${active.name} — ${new URL(active.url).hostname}` : '';
  $('#btn-reload').disabled = !active || !isRunning(active.id);
  $('#btn-focus').classList.toggle('active', state.ui.viewMode === 'focus');
  $('#btn-grid').classList.toggle('active', state.ui.viewMode === 'grid');

  stage.style.setProperty('--cols', String(Math.max(1, Math.ceil(Math.sqrt(shown.length)))));
  stage.replaceChildren();

  if (!shown.length) {
    stage.append(
      el('div', { class: 'cell' },
        el('strong', { text: 'Nenhuma conta ainda' }),
        el('span', { text: 'Adicione um jogo para começar.' }),
        el('button', { type: 'button', class: 'primary', text: '+ Conta', onclick: () => openSlotDialog({}) }),
      ),
    );
    return;
  }

  for (const slot of shown) {
    const rt = state.runtime[slot.id];
    if (!rt) {
      stage.append(
        el('div', { class: 'cell' },
          el('strong', { text: slot.name }),
          el('span', { text: 'Conta parada (não usa CPU nem memória).' }),
          el('button', { type: 'button', class: 'primary', text: 'Iniciar', onclick: () => deck.action('startSlot', { id: slot.id }) }),
        ),
      );
    } else {
      // Célula vazia: a página do jogo é colada exatamente por cima dela.
      stage.append(el('div', { class: 'cell', data: { slotId: slot.id }, text: rt.crashed ? 'A página travou. Use Recarregar.' : '' }));
    }
  }
}

/* ---------- medidor ---------- */

const percent = (value) => `${value.toFixed(1).replace('.', ',')}%`;

// Só troca o texto de alguns elementos; não redesenha a tela.
function renderMetrics() {
  if (!metrics) return;
  const mem = metrics.memMb >= 1024 ? `${(metrics.memMb / 1024).toFixed(1).replace('.', ',')} GB` : `${Math.round(metrics.memMb)} MB`;
  $('#meter').textContent = `CPU ${percent(metrics.cpu)} · RAM ${mem}`;
  for (const tag of document.querySelectorAll('.cpu[data-cpu-id]')) {
    const value = metrics.slots[tag.dataset.cpuId];
    tag.textContent = value == null ? '' : percent(value);
  }
}

function render() {
  if (!state) return;
  renderSidebar();
  renderStage();
  renderMetrics();
  syncLayout();
}

/* ---------- posição dos jogos ---------- */

// Mede as células e manda os retângulos para o processo principal, que posiciona as páginas.
// Com um diálogo aberto mandamos lista vazia: as páginas somem para não cobrir o diálogo.
function syncLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    const rects = $('#dialog').open
      ? []
      : [...document.querySelectorAll('.cell[data-slot-id]')].map((cell) => {
        const r = cell.getBoundingClientRect();
        return { id: cell.dataset.slotId, x: r.x, y: r.y, width: r.width, height: r.height };
      });
    const key = JSON.stringify(rects);
    if (key === lastLayout) return;
    lastLayout = key;
    deck.action('layout', { rects });
  });
}

/* ---------- diálogos ---------- */

function openDialog(title, fields, onSubmit, submitLabel = 'Salvar') {
  const dialog = $('#dialog');
  const form = $('#dialog-form');
  const error = el('p', { class: 'error', role: 'alert' });
  form.replaceChildren(
    el('h2', { text: title }),
    ...fields,
    error,
    el('div', { class: 'actions' },
      el('button', { type: 'button', text: 'Cancelar', onclick: () => dialog.close() }),
      el('button', { type: 'submit', class: 'primary', text: submitLabel }),
    ),
  );
  form.onsubmit = async (event) => {
    event.preventDefault();
    const result = await onSubmit(Object.fromEntries(new FormData(form)));
    if (result && result.error) error.textContent = result.error;
    else dialog.close();
  };
  dialog.showModal();
  syncLayout();
}

function textField(label, name, value, placeholder) {
  return el('label', {}, label, el('input', { type: 'text', name, value: value || '', placeholder, autocomplete: 'off' }));
}

function openSlotDialog({ id, groupId }) {
  const slot = id ? state.slots.find((s) => s.id === id) : null;
  if (id && !slot) return;
  const chosen = slot ? slot.groupId : groupId || (activeSlot() ? activeSlot().groupId : state.groups[0].id);
  const select = el('select', { name: 'groupId' },
    ...state.groups.map((g) => el('option', { value: g.id, selected: g.id === chosen, text: g.name })));
  openDialog(
    slot ? 'Editar conta' : 'Nova conta',
    [
      textField('Endereço do jogo', 'url', slot ? slot.url : '', 'https://jogo.com'),
      textField('Nome (opcional)', 'name', slot ? slot.name : '', 'Conta 1'),
      el('label', {}, 'Grupo', select),
      el('p', { class: 'hint', text: 'Cada conta tem login e dados separados das outras.' }),
    ],
    (data) => deck.action(slot ? 'editSlot' : 'addSlot', { ...data, ...(slot ? { id: slot.id } : {}) }),
    slot ? 'Salvar' : 'Adicionar',
  );
}

function openGroupDialog(id) {
  const group = id ? state.groups.find((g) => g.id === id) : null;
  if (id && !group) return;
  openDialog(
    group ? 'Renomear grupo' : 'Novo grupo',
    [textField('Nome do grupo', 'name', group ? group.name : '', 'Meus jogos')],
    (data) => deck.action(group ? 'renameGroup' : 'addGroup', { ...data, ...(group ? { id: group.id } : {}) }),
  );
}

function openSettingsDialog() {
  const check = (name, label) => el('label', { class: 'check' },
    el('input', { type: 'checkbox', name, checked: state.settings[name] }), label);
  openDialog(
    'Configurações',
    [
      check('closeToTray', 'Fechar a janela manda o app para a bandeja'),
      check('openAtLogin', 'Abrir junto com o sistema (oculto)'),
      el('p', { class: 'hint', text: 'Na bandeja os jogos continuam rodando sem desenhar nada, gastando o mínimo.' }),
    ],
    (data) => deck.action('setSettings', { closeToTray: 'closeToTray' in data, openAtLogin: 'openAtLogin' in data }),
  );
}

/* ---------- eventos ---------- */

$('#btn-add-slot').addEventListener('click', () => openSlotDialog({}));
$('#btn-add-group').addEventListener('click', () => openGroupDialog(null));
$('#btn-settings').addEventListener('click', openSettingsDialog);
$('#btn-mute-all').addEventListener('click', () => deck.action('setSettings', { muteAll: !state.settings.muteAll }));
$('#btn-reload').addEventListener('click', () => activeSlot() && deck.action('reloadSlot', { id: activeSlot().id }));
$('#btn-focus').addEventListener('click', () => deck.action('setViewMode', { viewMode: 'focus' }));
$('#btn-grid').addEventListener('click', () => deck.action('setViewMode', { viewMode: 'grid' }));
$('#dialog').addEventListener('close', syncLayout);

// O tamanho da área muda (janela redimensionada) -> reposiciona os jogos.
new ResizeObserver(syncLayout).observe($('#stage'));

deck.onState((next) => {
  state = next;
  if (!$('#dialog').open) render();
});
deck.onMetrics((next) => {
  metrics = next;
  renderMetrics();
});
deck.onCommand((command) => {
  if (command.type === 'editSlot') openSlotDialog({ id: command.id });
  else if (command.type === 'addSlot') openSlotDialog({ groupId: command.groupId });
  else if (command.type === 'renameGroup') openGroupDialog(command.id);
});
$('#dialog').addEventListener('close', render);

deck.getState().then((first) => {
  state = first;
  render();
});

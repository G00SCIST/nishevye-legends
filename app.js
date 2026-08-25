'use strict';

// ── Конфиг ─────────────────────────────────────────────────
const SUPA_URL = 'https://kaqzxmmjcmregofjnkkb.supabase.co';
const SUPA_KEY = 'sb_publishable_NwAGBGzSk0A-6h9fb-7nuQ_eN0um_n4'; // публичный, можно светить
const API_URL = `${SUPA_URL}/functions/v1/api`;

const tg = window.Telegram?.WebApp;
let session = { isAdmin: false, memberId: null };

// ── Элементы ───────────────────────────────────────────────
const grid = document.getElementById('sections');
const statsEl = document.getElementById('stats');
const emptyEl = document.getElementById('empty');
const searchEl = document.getElementById('search');
const tabsEl = document.getElementById('tabs');

const modal = document.getElementById('modal');
const modalCard = modal.querySelector('.modal-card');
const modalClose = modal.querySelector('.modal-close');

const rolesToggle = document.getElementById('roles-toggle');
const rolesPanel = document.getElementById('roles-panel');
const rolesCount = document.getElementById('roles-count');

const fab = document.getElementById('fab');
const sheet = document.getElementById('sheet');
const sheetBody = sheet.querySelector('.sheet-body');
const sheetClose = sheet.querySelector('.sheet-close');

const state = { tab: 'all', q: '', roles: new Set() };
let firstRender = true;
let lastFocused = null;

// ── Данные: живая база, data.js — запасной вариант ─────────
async function loadData() {
  const get = (path) =>
    fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: { apikey: SUPA_KEY } })
      .then(r => { if (!r.ok) throw new Error('REST ' + r.status); return r.json(); });

  const [members, peaks, hikes, hp, hm] = await Promise.all([
    get('members?select=*&order=created_at'),
    get('peaks?select=*'),
    get('hikes?select=*&order=seq'),
    get('hike_peaks?select=*'),
    get('hike_members?select=*'),
  ]);

  HEROES = members.map(m => ({
    id: m.id, name: m.name, nick: m.nick, title: m.title, status: m.status,
    rank: m.rank, roles: m.roles || [], place: m.place, quote: m.quote,
    photo: m.photo_url, hue: m.hue, claimed: !!m.telegram_id,
  }));
  PEAKS = Object.fromEntries(peaks.map(p => [p.name, p.alt]));
  HIKES = hikes.map(k => ({
    id: k.id, name: k.name,
    peaks: hp.filter(x => x.hike_id === k.id).map(x => x.peak),
    crew: hm.filter(x => x.hike_id === k.id).map(x => x.member_id),
  }));
}

async function refreshFromDB() {
  try {
    await loadData();
    buildRolesPanel();
    renderStats();
    render();
  } catch (e) {
    console.warn('база недоступна, работаем на встроенных данных', e);
  }
}

async function api(action, payload) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, initData: tg?.initData || '', payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

// ── Подсчёты ───────────────────────────────────────────────
const hikesFor = (h) => HIKES.filter(k => k.crew.includes(h.id));
const hikesOf = (h) => hikesFor(h).length;

// высота → уровень вершины и очки рейтинга
const altOf = (p) => PEAKS[p] ?? 0;
const tierOf = (p) => altOf(p) >= 2500 ? 'epic' : altOf(p) >= 2000 ? 'solid' : 'base';
const PTS = { epic: 100, solid: 50, base: 20 };

const ratingOf = (h) => hikesFor(h).reduce((s, k) =>
  s + (k.peaks.length ? k.peaks.reduce((a, p) => a + PTS[tierOf(p)], 0) : PTS.base), 0);

// покорённые вершины — только значимые, от 2000 м
const peaksOf = (h) => {
  const m = new Map();
  for (const k of hikesFor(h)) for (const p of k.peaks) {
    if (altOf(p) >= 2000) m.set(p, (m.get(p) || 0) + 1);
  }
  return [...m.entries()].map(([n, t]) => ({ n, t }))
    .sort((a, b) => altOf(b.n) - altOf(a.n));
};

// хайки героя, сгруппированные по маршруту: «Дзимба → Такао ×2»
const hikesAggOf = (h) => {
  const m = new Map();
  for (const k of hikesFor(h)) {
    const e = m.get(k.name) || { name: k.name, t: 0, epic: false };
    e.t += 1;
    e.epic = e.epic || k.peaks.some(p => tierOf(p) === 'epic');
    m.set(k.name, e);
  }
  return [...m.values()];
};

const fullName = (h) => h.nick ? `${h.name} <i>«${h.nick}»</i>` : h.name;
const initialsOf = (h) => h.nick ? (h.name[0] || '') + (h.nick[0] || '') : h.name.slice(0, 2);

const ART_SVG = `
  <svg class="art-peaks" viewBox="0 0 200 110" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 110 L46 38 L70 72 L102 16 L136 64 L158 42 L200 110 Z"/>
    <path class="far" d="M0 110 L30 76 L64 96 L118 58 L166 92 L200 70 L200 110 Z"/>
  </svg>`;

function artHTML(h, big = false) {
  const face = h.photo
    ? `<img class="art-photo" src="${h.photo}" alt="" loading="lazy">`
    : `${ART_SVG}<span class="art-initials" aria-hidden="true">${initialsOf(h)}</span>`;
  return `<div class="art ${big ? 'art-big' : ''}" style="--h:${h.hue}; --rc:${RANKS[h.rank].c}">${face}</div>`;
}

function renderStats() {
  const total = HEROES.length;
  const active = HEROES.filter(h => h.status === 'active').length;
  const hikes = HIKES.length;
  const peaks = new Set(HIKES.flatMap(k => k.peaks).filter(p => altOf(p) >= 2000)).size;
  const stat = (n, label) => `
    <div class="stat">
      <span class="stat-num">${n}</span>
      <span class="stat-label">${label}</span>
    </div>`;
  statsEl.innerHTML =
    stat(total, 'нишевых') + stat(active, 'в японии') +
    stat(hikes, 'хайков') + stat(peaks, 'вершин');
}

function cardHTML(h, i) {
  const rank = RANKS[h.rank];
  const delay = firstRender ? `animation-delay:${Math.min(i * 35, 520)}ms` : '';
  const marker = h.rank === 'creator'
    ? '<span class="stripe" aria-hidden="true"></span>'
    : '<span class="gem" aria-hidden="true"></span>';
  const leaves = h.rank === 'pathfinder'
    ? '<span class="leaves" aria-hidden="true"><i></i><i></i><i></i></span>'
    : '';
  return `
    <button class="card rank-${h.rank} ${h.status}" data-id="${h.id}" style="--rc:${rank.c}; ${delay}"
            aria-label="${h.name}${h.nick ? ` «${h.nick}»` : ''} — открыть профиль">
      ${artHTML(h)}
      ${marker}
      ${leaves}
      <span class="plate">
        <span class="plate-title">${h.title || rank.label}</span>
        <span class="plate-name">${fullName(h)}</span>
      </span>
    </button>`;
}

function render() {
  const q = state.q.trim().toLowerCase();
  const match = h =>
    !q || `${h.name} ${h.nick || ''} ${h.title || ''} ${RANKS[h.rank].label} ${h.place}`.toLowerCase().includes(q);
  const statusMatch = h => state.tab === 'all' || h.status === state.tab;
  const rolesMatch = h => !state.roles.size || [...state.roles].every(r => h.roles.includes(r));

  let idx = 0;
  let html = '';
  for (const key of RANK_ORDER) {
    const heroes = HEROES.filter(h => h.rank === key).filter(statusMatch).filter(rolesMatch).filter(match)
      .sort((a, b) => ratingOf(b) - ratingOf(a));
    if (!heroes.length) continue;
    html += `
      <section class="roster-section ${key === 'deity' ? 'section-deity' : ''}" style="--sc:${RANKS[key].c}">
        <h2 class="section-title">
          ${RANKS[key].plural} <span class="section-count">${heroes.length}</span>
        </h2>
        <div class="grid">${heroes.map(h => cardHTML(h, idx++)).join('')}</div>
      </section>`;
  }

  grid.innerHTML = html;
  emptyEl.hidden = html !== '';
  firstRender = false;

  grid.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => openModal(el.dataset.id, el));
  });
}

// ── Модалка героя ──────────────────────────────────────────

let pendingClose = null;

function openModal(id, sourceEl) {
  const h = HEROES.find(x => x.id === id);
  if (!h) return;
  if (pendingClose) { pendingClose(); pendingClose = null; }
  const rank = RANKS[h.rank];
  const status = h.status === 'active'
    ? `<span class="dot dot-active"></span> В строю · ${h.place}`
    : `<span class="dot dot-gone"></span> Легенда прошлого · сейчас — ${h.place}`;

  const myPeaks = peaksOf(h);
  const myHikes = hikesAggOf(h);
  const peaksBlock = myPeaks.length
    ? `<div class="chips">${myPeaks.map(p =>
        `<span class="chip chip-${tierOf(p.n)}">${p.n}${p.t > 1 ? ` <b>×${p.t}</b>` : ''}</span>`).join('')}</div>`
    : `<p class="peaks-empty">Пока ни одной — всё впереди.</p>`;
  const hikesBlock = myHikes.length
    ? `<div class="chips">${myHikes.map(k =>
        `<span class="chip ${k.epic ? 'chip-epic' : ''}">${k.name}${k.t > 1 ? ` <b>×${k.t}</b>` : ''}</span>`).join('')}</div>`
    : `<p class="peaks-empty">Пока ни одного — всё впереди.</p>`;

  const actions = [];
  if (tg?.initData && !session.isAdmin && !session.memberId && !h.claimed)
    actions.push('<button class="btn btn-ghost" data-act="claim">Это моя карточка</button>');
  if (session.isAdmin || (session.memberId && session.memberId === h.id))
    actions.push('<button class="btn btn-ghost" data-act="edit">Редактировать</button>');

  modalCard.className = `modal-card rank-${h.rank}`;
  modalCard.style.setProperty('--rc', rank.c);
  modalCard.querySelector('.modal-art-slot').innerHTML = artHTML(h, true);
  modalCard.querySelector('.modal-body').innerHTML = `
    <span class="rank-pill">${rank.label}</span>
    <h3 class="modal-name" id="modal-name">${fullName(h)}</h3>
    ${h.title ? `<p class="modal-title-line">${h.title}</p>` : ''}
    ${h.quote ? `<blockquote class="modal-quote">${h.quote}</blockquote>` : ''}

    <div class="stat-tiles">
      <div class="tile"><span class="tile-num">${hikesOf(h)}</span><span class="tile-label">хайков</span></div>
      <div class="tile"><span class="tile-num">${myPeaks.length}</span><span class="tile-label">вершин</span></div>
      <div class="tile"><span class="tile-num">${ratingOf(h)}</span><span class="tile-label">рейтинг</span></div>
    </div>
    <div class="rating-bar" role="img" aria-label="Рейтинг относительно лидера команды"><i></i></div>

    ${h.roles.length ? `
      <p class="modal-sub">Роли в пати</p>
      <div class="chips">${h.roles.map(r => `<span class="chip chip-role">${r}</span>`).join('')}</div>` : ''}

    <p class="modal-sub">Покорённые вершины · 2000 м+</p>
    ${peaksBlock}

    <p class="modal-sub">Хайки</p>
    ${hikesBlock}

    <p class="modal-status">${status}</p>
    ${actions.length ? `<div class="modal-actions">${actions.join('')}</div>` : ''}`;

  modalCard.querySelector('[data-act="claim"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api('claim', { member_id: h.id });
      session.memberId = h.id;
      await refreshFromDB();
      closeModal();
      toast('Карточка твоя! Теперь можешь её редактировать.');
      haptic('success');
    } catch (err) {
      toast('Не вышло: ' + err.message);
      haptic('error');
      btn.disabled = false;
    }
  });
  modalCard.querySelector('[data-act="edit"]')?.addEventListener('click', () => openEditor(h));

  lastFocused = sourceEl;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => modal.classList.add('open'));
  modalClose.focus();

  // шкала: доля рейтинга героя от лидера команды, дорастает с анимацией
  const maxRating = Math.max(...HEROES.map(ratingOf), 1);
  const pct = Math.max(3, Math.round(ratingOf(h) / maxRating * 100));
  const bar = modalCard.querySelector('.rating-bar i');
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = pct + '%'; }));
}

function closeModal() {
  modal.classList.remove('open');
  if (sheet.hidden) document.body.classList.remove('modal-open');
  const done = () => {
    modal.hidden = true;
    modal.removeEventListener('transitionend', done);
    clearTimeout(timer);
    pendingClose = null;
  };
  modal.addEventListener('transitionend', done);
  const timer = setTimeout(done, 250); // страховка, если transitionend не сработает
  pendingClose = done; // повторное открытие до конца анимации не должно спрятать модалку
  lastFocused?.focus();
}

modalClose.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

// ── Шторка с формами (правка, запись хайка) ────────────────

let sheetCloseTimer = null;

function openSheet(html) {
  clearTimeout(sheetCloseTimer); // отложенное закрытие не должно спрятать новую шторку
  sheet.classList.remove('open');
  sheetBody.innerHTML = html;
  sheet.hidden = false;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => sheet.classList.add('open'));
  sheetClose.focus();
}

function closeSheet() {
  sheet.classList.remove('open');
  clearTimeout(sheetCloseTimer);
  sheetCloseTimer = setTimeout(() => {
    sheet.hidden = true;
    if (modal.hidden) document.body.classList.remove('modal-open');
  }, 200);
}

sheetClose.addEventListener('click', closeSheet);
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!sheet.hidden) return closeSheet();
    if (!modal.hidden) return closeModal();
  }
  if (!modal.hidden && sheet.hidden && e.key === 'Tab') {
    // фокус не должен уходить за пределы модалки
    const focusables = modal.querySelectorAll('button, [href]');
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
});

// ── Редактор карточки ──────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/"/g, '&quot;');

function openEditor(h) {
  const admin = session.isAdmin;
  const f = (label, html) => `<label class="f-label">${label}</label>${html}`;
  const text = (id, val, ph = '') =>
    `<input id="${id}" class="f-input" value="${esc(val)}" placeholder="${ph}">`;

  let inner = `<h3 class="sheet-title">${h.name} — правка</h3>`;
  if (admin) {
    inner += f('Имя', text('ef-name', h.name));
    inner += f('Прозвище', text('ef-nick', h.nick));
    inner += f('Титул', text('ef-title', h.title, 'Например: Хранитель маршрутов'));
    inner += f('Ранг', `<select id="ef-rank" class="f-input">${RANK_ORDER.map(r =>
      `<option value="${r}" ${h.rank === r ? 'selected' : ''}>${RANKS[r].label}</option>`).join('')}</select>`);
    inner += f('Статус', `<select id="ef-status" class="f-input">
      <option value="active" ${h.status === 'active' ? 'selected' : ''}>В строю</option>
      <option value="gone" ${h.status === 'gone' ? 'selected' : ''}>Легенда прошлого</option>
    </select>`);
    inner += f('Роли (через запятую)', text('ef-roles', h.roles.join(', ')));
  } else {
    inner += f('Прозвище', text('ef-nick', h.nick));
  }
  inner += f('Где сейчас', text('ef-place', h.place));
  inner += f('Коронная фраза', text('ef-quote', h.quote));
  inner += f('Оттенок карточки (0–360)',
    `<input id="ef-hue" class="f-input" type="number" min="0" max="360" value="${h.hue}">`);
  inner += `<button id="ef-save" class="btn btn-primary">Сохранить</button>`;

  openSheet(inner);

  document.getElementById('ef-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const v = (id) => document.getElementById(id)?.value.trim();
    const fields = {
      nick: v('ef-nick') || null,
      place: v('ef-place') || null,
      quote: v('ef-quote') || null,
      hue: Math.min(360, Math.max(0, Number(v('ef-hue')) || h.hue)),
    };
    if (admin) Object.assign(fields, {
      name: v('ef-name') || h.name,
      title: v('ef-title') || null,
      rank: v('ef-rank'),
      status: v('ef-status'),
      roles: (v('ef-roles') || '').split(',').map(s => s.trim()).filter(Boolean),
    });
    btn.disabled = true;
    btn.textContent = 'Сохраняю…';
    try {
      await api('update_member', { id: h.id, fields });
      await refreshFromDB();
      closeSheet();
      closeModal();
      toast('Сохранено');
      haptic('success');
    } catch (err) {
      toast('Не вышло: ' + err.message);
      haptic('error');
      btn.disabled = false;
      btn.textContent = 'Сохранить';
    }
  });
}

// ── Запись хайка (только Создатель) ────────────────────────

function peakRowHTML() {
  return `
    <div class="peak-row">
      <input class="f-input pk-name" list="peak-list" placeholder="Гора">
      <input class="f-input pk-alt" type="number" placeholder="Высота, м">
      <button type="button" class="row-x" aria-label="Убрать вершину">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
}

function openHikeForm() {
  const activeFirst = [...HEROES].sort((a, b) =>
    (a.status === 'gone') - (b.status === 'gone') || a.name.localeCompare(b.name, 'ru'));
  openSheet(`
    <h3 class="sheet-title">Записать хайк</h3>
    <label class="f-label">Маршрут</label>
    <input id="hf-name" class="f-input" placeholder="Например: Дзимба → Такао">
    <label class="f-label">Вершины (можно несколько, можно ни одной)</label>
    <div id="hf-peaks">${peakRowHTML()}</div>
    <button id="hf-add-peak" type="button" class="btn btn-ghost btn-sm">+ ещё вершина</button>
    <label class="f-label">Кто ходил</label>
    <div id="hf-crew" class="chips">${activeFirst.map(h =>
      `<button type="button" class="role-chip" data-m="${h.id}" aria-pressed="false">${h.name}${h.nick ? ` «${h.nick}»` : ''}</button>`).join('')}</div>
    <button id="hf-save" class="btn btn-primary">Записать хайк</button>
    <datalist id="peak-list">${Object.keys(PEAKS).map(p => `<option value="${esc(p)}">`).join('')}</datalist>
  `);

  const peaksBox = document.getElementById('hf-peaks');
  document.getElementById('hf-add-peak').addEventListener('click', () => {
    peaksBox.insertAdjacentHTML('beforeend', peakRowHTML());
  });
  peaksBox.addEventListener('click', (e) => {
    const x = e.target.closest('.row-x');
    if (x && peaksBox.children.length > 1) x.closest('.peak-row').remove();
  });
  peaksBox.addEventListener('input', (e) => {
    // подставляем известную высоту автоматически
    if (!e.target.classList.contains('pk-name')) return;
    const alt = PEAKS[e.target.value.trim()];
    const altInput = e.target.closest('.peak-row').querySelector('.pk-alt');
    if (alt != null && !altInput.value) altInput.value = alt;
  });
  document.getElementById('hf-crew').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-m]');
    if (!chip) return;
    chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
  });

  document.getElementById('hf-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const name = document.getElementById('hf-name').value.trim();
    const peaks = [...peaksBox.querySelectorAll('.peak-row')].map(r => ({
      name: r.querySelector('.pk-name').value.trim(),
      alt: Number(r.querySelector('.pk-alt').value) || null,
    })).filter(p => p.name);
    const member_ids = [...document.querySelectorAll('#hf-crew [aria-pressed="true"]')].map(b => b.dataset.m);
    if (!name) { toast('Дай маршруту имя'); return; }
    if (!member_ids.length) { toast('Отметь, кто ходил'); return; }
    btn.disabled = true;
    btn.textContent = 'Записываю…';
    try {
      await api('record_hike', { name, peaks, member_ids });
      await refreshFromDB();
      closeSheet();
      toast(`«${name}» записан — рейтинг обновился у ${member_ids.length} чел.`);
      haptic('success');
    } catch (err) {
      toast('Не вышло: ' + err.message);
      haptic('error');
      btn.disabled = false;
      btn.textContent = 'Записать хайк';
    }
  });
}

fab.addEventListener('click', openHikeForm);

// ── Тост и хаптика ─────────────────────────────────────────

let toastTimer;
function toast(msg, ms = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => { t.hidden = true; }, 250);
  }, ms);
}

const haptic = (type) => tg?.HapticFeedback?.notificationOccurred?.(type);

// ── Управление ─────────────────────────────────────────────

tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  state.tab = btn.dataset.tab;
  tabsEl.querySelectorAll('[data-tab]').forEach(b =>
    b.setAttribute('aria-pressed', String(b === btn)));
  render();
});

let searchTimer;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = searchEl.value;
    render();
  }, 120);
});

// ── Фильтр по ролям ────────────────────────────────────────

function buildRolesPanel() {
  const counts = new Map();
  for (const h of HEROES) for (const r of h.roles) counts.set(r, (counts.get(r) || 0) + 1);
  const roles = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
  rolesPanel.innerHTML =
    roles.map(([r, n]) =>
      `<button class="role-chip" data-role="${esc(r)}" aria-pressed="${state.roles.has(r)}">${r} <b>${n}</b></button>`).join('') +
    `<button class="role-chip role-reset" id="roles-reset" ${state.roles.size ? '' : 'hidden'}>Сбросить</button>`;
}

function syncRolesUI() {
  const n = state.roles.size;
  rolesCount.hidden = n === 0;
  rolesCount.textContent = n;
  document.getElementById('roles-reset').hidden = n === 0;
}

rolesToggle.addEventListener('click', () => {
  const open = rolesPanel.hidden;
  rolesPanel.hidden = !open;
  rolesToggle.setAttribute('aria-expanded', String(open));
});

rolesPanel.addEventListener('click', (e) => {
  const reset = e.target.closest('.role-reset');
  if (reset) {
    state.roles.clear();
    rolesPanel.querySelectorAll('[data-role]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    syncRolesUI();
    render();
    return;
  }
  const btn = e.target.closest('[data-role]');
  if (!btn) return;
  const role = btn.dataset.role;
  const on = !state.roles.has(role);
  state.roles[on ? 'add' : 'delete'](role);
  btn.setAttribute('aria-pressed', String(on));
  syncRolesUI();
  render();
});

// ── Telegram Mini App ──────────────────────────────────────

async function initTelegram() {
  if (!tg || tg.initData === undefined) return;
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0a0d13');
  tg.setBackgroundColor('#0a0d13');
  if (!tg.initData) return; // открыто в обычном браузере — только просмотр
  try {
    session = await api('me');
    if (session.isAdmin) {
      fab.hidden = false;
    } else if (!session.memberId) {
      toast('Найди свою карточку и нажми «Это моя карточка»', 5000);
    }
  } catch (e) {
    console.warn('auth', e);
  }
}

// ── Старт: мгновенный рендер из запаса, потом живая база ───

buildRolesPanel();
renderStats();
render();
initTelegram();
refreshFromDB();

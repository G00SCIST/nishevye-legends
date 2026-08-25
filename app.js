'use strict';

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

const state = { tab: 'all', q: '', roles: new Set() };
let firstRender = true;
let lastFocused = null;

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

// ── Модалка ────────────────────────────────────────────────

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

    ${h.roles.length ? `
      <p class="modal-sub">Роли в пати</p>
      <div class="chips">${h.roles.map(r => `<span class="chip chip-role">${r}</span>`).join('')}</div>` : ''}

    <p class="modal-sub">Покорённые вершины · 2000 м+</p>
    ${peaksBlock}

    <p class="modal-sub">Хайки</p>
    ${hikesBlock}

    <p class="modal-status">${status}</p>`;

  lastFocused = sourceEl;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => modal.classList.add('open'));
  modalClose.focus();
}

function closeModal() {
  modal.classList.remove('open');
  document.body.classList.remove('modal-open');
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

document.addEventListener('keydown', (e) => {
  if (modal.hidden) return;
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Tab') {
    // фокус не должен уходить за пределы модалки
    const focusables = modal.querySelectorAll('button, [href]');
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
});

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
      `<button class="role-chip" data-role="${r}" aria-pressed="false">${r} <b>${n}</b></button>`).join('') +
    `<button class="role-chip role-reset" id="roles-reset" hidden>Сбросить</button>`;
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

buildRolesPanel();
renderStats();
render();

// ── Telegram Mini App ──────────────────────────────────────
// вне Телеграма (обычный браузер) блок просто не срабатывает
if (window.Telegram?.WebApp?.initData !== undefined) {
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0a0d13');
  tg.setBackgroundColor('#0a0d13');
}

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

const hikesOf = (h) => h.peaks.reduce((s, p) => s + p.t, 0);
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
  const hikes = HEROES.reduce((s, h) => s + hikesOf(h), 0);
  const peaks = new Set(HEROES.flatMap(h => h.peaks.map(p => p.n))).size;
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
    const heroes = HEROES.filter(h => h.rank === key).filter(statusMatch).filter(rolesMatch).filter(match);
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

  const peaksBlock = h.peaks.length
    ? `<div class="chips">${h.peaks.map(p => `<span class="chip">${p.n} <b>×${p.t}</b></span>`).join('')}</div>`
    : `<p class="peaks-empty">Пока не отмечены — скоро тут будет вся история хайков.</p>`;

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
      <div class="tile"><span class="tile-num">${h.peaks.length}</span><span class="tile-label">вершин</span></div>
    </div>

    ${h.roles.length ? `
      <p class="modal-sub">Роли в пати</p>
      <div class="chips">${h.roles.map(r => `<span class="chip chip-role">${r}</span>`).join('')}</div>` : ''}

    <p class="modal-sub">Покорённые вершины</p>
    ${peaksBlock}

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

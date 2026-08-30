'use strict';

// ── Конфиг ─────────────────────────────────────────────────
const SUPA_URL = 'https://kaqzxmmjcmregofjnkkb.supabase.co';
const SUPA_KEY = 'sb_publishable_NwAGBGzSk0A-6h9fb-7nuQ_eN0um_n4'; // публичный, можно светить
const API_URL = `${SUPA_URL}/functions/v1/api`;

const tg = window.Telegram?.WebApp;
let session = { isAdmin: false, memberId: null };
let ROLES = []; // словарь ролей из базы; пока пуст — выводится из карточек

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
const fabSet = document.getElementById('fab-set');
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

  const [members, peaks, hikes, hp, hm, roles] = await Promise.all([
    get('members?select=*&order=created_at'),
    get('peaks?select=*'),
    get('hikes?select=*&order=seq'),
    get('hike_peaks?select=*'),
    get('hike_members?select=*'),
    get('roles?select=name'),
  ]);
  ROLES = roles.map(r => r.name).sort((a, b) => a.localeCompare(b, 'ru'));

  HEROES = members.map(m => ({
    id: m.id, name: m.name, nick: m.nick, title: m.title, status: m.status,
    rank: m.rank, roles: m.roles || [], place: m.place, quote: m.quote,
    photo: m.photo_url, photoWide: m.photo_wide_url, hue: m.hue, claimed: !!m.telegram_id,
    tgUsername: m.tg_username, insta: m.insta, tiktok: m.tiktok,
  }));
  PEAKS = Object.fromEntries(peaks.map(p => [p.name, p.alt]));
  HIKES = hikes.map(k => ({
    id: k.id, name: k.name, deck: k.deck_url,
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
const tierByAlt = (alt) => (alt || 0) >= 2500 ? 'epic' : (alt || 0) >= 2000 ? 'solid' : 'base';
const tierOf = (p) => tierByAlt(altOf(p));
const TIER_LABEL = { epic: 'эпик', solid: 'крепкая', base: 'обычная' };
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

// подпись хайка: повторные заходы по тому же маршруту нумеруются
const hikeLabel = (k) => {
  const same = HIKES.filter(x => x.name === k.name);
  if (same.length < 2) return k.name;
  return `${k.name} · заход ${same.findIndex(x => x.id === k.id) + 1}`;
};
const initialsOf = (h) => h.nick ? (h.name[0] || '') + (h.nick[0] || '') : h.name.slice(0, 2);

const ART_SVG = `
  <svg class="art-peaks" viewBox="0 0 200 110" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 110 L46 38 L70 72 L102 16 L136 64 L158 42 L200 110 Z"/>
    <path class="far" d="M0 110 L30 76 L64 96 L118 58 L166 92 L200 70 L200 110 Z"/>
  </svg>`;

function artHTML(h, big = false) {
  let face;
  if (h.photo) {
    // в широкой шапке профиля на телефоне показываем широкий кадр, если он есть
    const wide = big && h.photoWide
      ? `<source media="(max-width: 640px)" srcset="${h.photoWide}">`
      : '';
    face = `<picture>${wide}<img class="art-photo" src="${h.photo}" alt="" loading="lazy"></picture>`;
  } else {
    face = `${ART_SVG}<span class="art-initials" aria-hidden="true">${initialsOf(h)}</span>`;
  }
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

// мини-карточка участника для веера в маршруте
function fanCardHTML(h) {
  const face = h.photo
    ? `<img src="${h.photo}" alt="" loading="lazy">`
    : `<span>${initialsOf(h)}</span>`;
  return `
    <button class="fan-card ${h.status}" data-id="${h.id}" style="--h:${h.hue}; --rc:${RANKS[h.rank].c}"
            title="${h.name}${h.nick ? ` «${h.nick}»` : ''}"
            aria-label="${h.name}${h.nick ? ` «${h.nick}»` : ''} — открыть профиль">${face}</button>`;
}

function routeCardHTML(k, idx) {
  const same = HIKES.filter(x => x.name === k.name);
  const runNo = same.length > 1 ? same.findIndex(x => x.id === k.id) + 1 : 0;
  const crew = k.crew.map(id => HEROES.find(h => h.id === id)).filter(Boolean)
    .sort((a, b) => RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));
  const shown = crew.slice(0, 14);
  const rest = crew.length - shown.length;
  const isEpic = k.peaks.some(p => tierOf(p) === 'epic');

  return `
    <article class="route-card ${isEpic ? 'route-epic' : ''}">
      <div class="route-head">
        <h3 class="route-name">${esc(k.name)}${runNo ? ` <span class="route-run">заход ${runNo}</span>` : ''}</h3>
        <span class="route-num">#${idx}</span>
      </div>

      ${k.peaks.length
        ? `<div class="chips route-peaks">${k.peaks.map(p =>
            `<span class="chip chip-${tierOf(p)}">${esc(p)} <b>${altOf(p) ? altOf(p) + ' м' : '?'}</b></span>`).join('')}</div>`
        : '<p class="route-nopeak">Без вершины</p>'}

      <div class="route-crew" data-hike="${k.id}">
        <div class="fan">${shown.map(fanCardHTML).join('')}${rest > 0 ? `<span class="fan-rest">+${rest}</span>` : ''}</div>
        <p class="route-names">${crew.map(h =>
          `<button class="name-link" data-id="${h.id}">${h.name}${h.nick ? ` «${h.nick}»` : ''}</button>`).join('')}</p>
      </div>

      <div class="route-actions">
        <span class="route-count">${crew.length} ${crew.length === 1 ? 'нишевый' : 'нишевых'}</span>
        ${k.deck ? `<button class="btn btn-ghost btn-sm route-deck" data-url="${esc(k.deck)}">📑 Презентация</button>` : ''}
        ${session.isAdmin ? `<button class="btn btn-ghost btn-sm route-edit" data-k="${k.id}">Править</button>` : ''}
      </div>
    </article>`;
}

function renderRoutes() {
  const q = state.q.trim().toLowerCase();
  const list = [...HIKES]
    .map((k, i) => ({ k, idx: i + 1 }))
    .filter(({ k }) => !q || (k.name + ' ' + k.peaks.join(' ')).toLowerCase().includes(q))
    .reverse();

  grid.innerHTML = list.length
    ? `<section class="roster-section" style="--sc:var(--gold)">
         <h2 class="section-title">Все маршруты <span class="section-count">${list.length}</span></h2>
         <div class="routes">${list.map(({ k, idx }) => routeCardHTML(k, idx)).join('')}</div>
       </section>`
    : '';
  emptyEl.hidden = list.length > 0;

  grid.querySelectorAll('.route-crew').forEach(box => {
    box.addEventListener('click', (e) => {
      const who = e.target.closest('[data-id]');
      if (who) {
        const el = who;
        openModal(who.dataset.id, el);
        return;
      }
      box.classList.toggle('open'); // тап по вееру раскрывает имена
    });
  });

  grid.querySelectorAll('.route-deck').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank', 'noopener');
    });
  });

  grid.querySelectorAll('.route-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const hike = HIKES.find(x => x.id === Number(btn.dataset.k));
      if (hike) openHikeEdit(hike);
    });
  });
}

function render() {
  if (state.tab === 'routes') return renderRoutes();
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

  const socials = [];
  if (h.tgUsername) socials.push(`
    <button type="button" class="soc-link soc-tg" data-url="https://t.me/${esc(h.tgUsername)}" data-tg-native="1">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>
      @${esc(h.tgUsername)}
    </button>`);
  if (h.insta) socials.push(`
    <button type="button" class="soc-link soc-ig" data-url="https://instagram.com/${esc(h.insta)}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.5" fill="currentColor"/></svg>
      ${esc(h.insta)}
    </button>`);
  if (h.tiktok) socials.push(`
    <button type="button" class="soc-link soc-tt" data-url="https://www.tiktok.com/@${esc(h.tiktok)}">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>
      ${esc(h.tiktok)}
    </button>`);

  modalCard.className = `modal-card rank-${h.rank}`;
  modalCard.style.setProperty('--rc', rank.c);
  modalCard.querySelector('.modal-art-slot').innerHTML = artHTML(h, true);
  modalCard.querySelector('.modal-body').innerHTML = `
    <span class="rank-pill">${rank.label}</span>
    <h3 class="modal-name" id="modal-name">${fullName(h)}</h3>
    ${h.title ? `<p class="modal-title-line">${h.title}</p>` : ''}
    ${socials.length ? `<div class="socials">${socials.join('')}</div>` : ''}
    ${h.quote ? `<blockquote class="modal-quote">${h.quote}</blockquote>` : ''}

    <div class="stat-tiles">
      <div class="tile"><span class="tile-num">${hikesOf(h)}</span><span class="tile-label">хайков</span></div>
      <div class="tile"><span class="tile-num">${myPeaks.length}</span><span class="tile-label">вершин</span></div>
      <div class="tile"><span class="tile-num">${ratingOf(h)}</span><span class="tile-label">рейтинг</span></div>
    </div>
    <p class="rank-place" id="rank-place"></p>
    <div class="rating-bar" role="img" aria-label="Прогресс до следующего места"><i></i></div>

    ${h.roles.length ? `
      <p class="modal-sub">Роли в пати</p>
      <div class="chips">${h.roles.map(r => `<span class="chip chip-role">${r}</span>`).join('')}</div>` : ''}

    <p class="modal-sub">Покорённые вершины · 2000 м+</p>
    ${peaksBlock}

    <p class="modal-sub">Хайки</p>
    ${hikesBlock}

    <p class="modal-status">${status}</p>
    ${actions.length ? `<div class="modal-actions">${actions.join('')}</div>` : ''}`;

  modalCard.querySelectorAll('.soc-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (btn.dataset.tgNative && tg?.openTelegramLink) tg.openTelegramLink(url);
      else if (tg?.openLink) tg.openLink(url);
      else window.open(url, '_blank', 'noopener');
    });
  });

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

  // шкала: место в общем зачёте и сколько очков до того, кто выше
  const board = [...HEROES].sort((a, b) => ratingOf(b) - ratingOf(a));
  const my = ratingOf(h);
  const place = board.findIndex(x => x.id === h.id) + 1;
  const above = board.slice(0, place - 1).reverse().find(x => ratingOf(x) > my);
  const placeEl = modalCard.querySelector('#rank-place');
  let pct;
  if (!above) {
    placeEl.innerHTML = `<b>#1 в команде</b> · выше только горы`;
    pct = 100;
  } else {
    const gap = ratingOf(above) - my;
    const below = board.slice(place).find(x => ratingOf(x) < my);
    const floor = below ? ratingOf(below) : 0;
    pct = Math.max(4, Math.round((my - floor) / Math.max(ratingOf(above) - floor, 1) * 100));
    placeEl.innerHTML = `<b>#${place} из ${board.length}</b> · до ${above.name}${above.nick ? ` «${above.nick}»` : ''} — ${gap} очк.`;
  }
  const bar = modalCard.querySelector('.rating-bar i');
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transform = `scaleX(${pct / 100})`; }));
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

// ── Клавиатура на телефоне не должна прятать поле ──────────
// высоту клавиатуры кладём в --kb: снизу появляется запас, куда можно проскроллить
const scrollFieldIntoView = (el) => {
  if (!el?.scrollIntoView) return;
  setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
};

sheet.addEventListener('focusin', (e) => {
  if (e.target.matches?.('input, textarea, select')) scrollFieldIntoView(e.target);
});

if (window.visualViewport) {
  const vv = window.visualViewport;
  const sync = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', kb + 'px');
    const a = document.activeElement;
    if (kb > 0 && a?.matches?.('input, textarea')) scrollFieldIntoView(a);
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
}

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
    inner += f('Telegram (юзернейм без @)', text('ef-tg', h.tgUsername, 'например: GOOSCIST'));
    if (h.claimed) {
      inner += `<button type="button" id="ef-unbind" class="btn btn-ghost btn-sm">Отвязать Telegram — карточка станет свободной</button>`;
    }
    inner += f('Ранг', `<select id="ef-rank" class="f-input">${RANK_ORDER.map(r =>
      `<option value="${r}" ${h.rank === r ? 'selected' : ''}>${RANKS[r].label}</option>`).join('')}</select>`);
    inner += f('Статус', `<select id="ef-status" class="f-input">
      <option value="active" ${h.status === 'active' ? 'selected' : ''}>В строю</option>
      <option value="gone" ${h.status === 'gone' ? 'selected' : ''}>Легенда прошлого</option>
    </select>`);
    inner += f('Роли — тыкай, чтобы выдать или снять', `<div id="ef-roles" class="chips">${roleDict().map(r =>
      `<button type="button" class="role-chip" data-r="${esc(r)}" aria-pressed="${h.roles.includes(r)}">${r}</button>`).join('')}</div>
      <p class="f-hint">Добавить новую роль в перечень можно в настройках (шестерёнка).</p>`);
  } else {
    inner += f('Прозвище', text('ef-nick', h.nick));
  }
  if (admin) {
    const routeNames = [...new Set(HIKES.map(k => k.name))];
    inner += f('Хайки — сколько раз ходил', `<div id="ef-hikes" class="chips">${routeNames.map(name => {
      const runs = HIKES.filter(k => k.name === name);
      const mine = runs.filter(k => k.crew.includes(h.id)).length;
      return `<button type="button" class="role-chip" data-route="${esc(name)}" data-n="${mine}" data-max="${runs.length}"
                aria-pressed="${mine > 0}">${esc(name)}${mine > 1 ? ` <b>×${mine}</b>` : ''}</button>`;
    }).join('')}</div>
      <p class="f-hint">Тапай, чтобы добавить заход. Где маршрут был несколько раз — тапни ещё раз, станет ×2.</p>`);
  }
  inner += f('Фото', `
    <div class="photo-row">
      <button type="button" id="ef-photo-btn" class="btn btn-ghost btn-sm">${h.photo ? 'Заменить фото' : 'Загрузить фото'}</button>
      <input id="ef-photo" type="file" accept="image/*" hidden>
      <span id="ef-photo-note" class="f-hint">${h.photo ? 'Фото стоит' : 'Пока инициалы'}</span>
    </div>
    <div id="ef-crop"></div>`);
  const HUES = [0, 25, 45, 90, 140, 175, 200, 225, 260, 290, 320, 345];
  const nearest = HUES.reduce((best, hh) => Math.abs(hh - h.hue) < Math.abs(best - h.hue) ? hh : best, HUES[0]);
  inner += f('Цвет карточки', `<div id="ef-hue" class="hue-row">${HUES.map(hh =>
    `<button type="button" class="hue-dot" data-hue="${hh}" aria-pressed="${hh === nearest}" style="--hd:${hh}" aria-label="Оттенок ${hh}"></button>`).join('')}</div>`);
  inner += f('Instagram (ник без @, по желанию)', text('ef-insta', h.insta));
  inner += f('TikTok (ник без @, по желанию)', text('ef-tt', h.tiktok));
  inner += f('Где сейчас', text('ef-place', h.place));
  inner += f('Коронная фраза', text('ef-quote', h.quote));
  inner += `<button id="ef-save" class="btn btn-primary">Сохранить</button>`;

  openSheet(inner);

  document.getElementById('ef-hikes')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-route]');
    if (!chip) return;
    const max = Number(chip.dataset.max);
    const n = (Number(chip.dataset.n) + 1) % (max + 1);
    chip.dataset.n = n;
    chip.setAttribute('aria-pressed', String(n > 0));
    chip.innerHTML = `${chip.dataset.route}${n > 1 ? ` <b>×${n}</b>` : ''}`;
  });

  document.getElementById('ef-hue').addEventListener('click', (e) => {
    const dot = e.target.closest('.hue-dot');
    if (!dot) return;
    document.querySelectorAll('#ef-hue .hue-dot').forEach(d => d.setAttribute('aria-pressed', 'false'));
    dot.setAttribute('aria-pressed', 'true');
  });

  // выбрал файл → открывается кадрирование прямо в форме
  const photoInput = document.getElementById('ef-photo');
  document.getElementById('ef-photo-btn').addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    photoFlow(file, h, document.getElementById('ef-photo-note'));
    photoInput.value = '';
  });

  document.getElementById('ef-unbind')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api('update_member', { id: h.id, fields: { telegram_id: null, tg_username: null } });
      await refreshFromDB();
      closeSheet();
      closeModal();
      toast('Карточка отвязана — теперь её можно привязать заново');
      haptic('success');
    } catch (err) {
      toast('Не вышло: ' + err.message);
      haptic('error');
      btn.disabled = false;
    }
  });

  document.getElementById('ef-roles')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-r]');
    if (!chip) return;
    chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
  });

  document.getElementById('ef-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const v = (id) => document.getElementById(id)?.value.trim();
    const fields = {
      nick: v('ef-nick') || null,
      place: v('ef-place') || null,
      quote: v('ef-quote') || null,
      insta: (v('ef-insta') || '').replace(/^@/, '') || null,
      tiktok: (v('ef-tt') || '').replace(/^@/, '') || null,
      hue: Number(document.querySelector('#ef-hue [aria-pressed="true"]')?.dataset.hue ?? h.hue),
    };
    if (admin) Object.assign(fields, {
      name: v('ef-name') || h.name,
      title: v('ef-title') || null,
      tg_username: (v('ef-tg') || '').replace(/^@/, '') || null,
      rank: v('ef-rank'),
      status: v('ef-status'),
      roles: [...document.querySelectorAll('#ef-roles [aria-pressed="true"]')].map(b => b.dataset.r),
    });
    btn.disabled = true;
    btn.textContent = 'Сохраняю…';
    try {
      await api('update_member', { id: h.id, fields });
      if (admin) {
        // из «сколько раз ходил» собираем конкретные заходы, не трогая уже отмеченные
        const hikeIds = [];
        for (const chip of document.querySelectorAll('#ef-hikes [data-route]')) {
          const want = Number(chip.dataset.n);
          const runs = HIKES.filter(k => k.name === chip.dataset.route);
          const already = runs.filter(k => k.crew.includes(h.id));
          const rest = runs.filter(k => !k.crew.includes(h.id));
          const picked = already.slice(0, want).map(k => k.id);
          while (picked.length < want && rest.length) picked.push(rest.shift().id);
          hikeIds.push(...picked);
        }
        const before = HIKES.filter(k => k.crew.includes(h.id)).map(k => k.id).sort().join(',');
        if (hikeIds.slice().sort().join(',') !== before) {
          await api('set_member_hikes', { member_id: h.id, hike_ids: hikeIds });
        }
      }
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

// два кадра из одного фото: вертикальный для карточки и широкий для профиля
async function photoFlow(file, h, note) {
  const portrait = await cropStep(file, 3, 4, 900, 1200,
    'Шаг 1 из 2 · кадр для карточки (вертикальный)', 'Дальше: широкий кадр');
  if (!portrait) return;
  const wide = await cropStep(file, 3, 2, 1200, 800,
    'Шаг 2 из 2 · кадр для профиля на телефоне (широкий)', 'Загрузить оба');
  if (!wide) return;
  note.textContent = 'Загружаю…';
  try {
    await api('set_photo', { id: h.id, data: portrait, wide });
    await refreshFromDB();
    note.textContent = 'Фото обновлено!';
    toast('Фото обновлено');
    haptic('success');
  } catch (err) {
    note.textContent = 'Не вышло: ' + err.message;
    haptic('error');
  }
}

// один шаг кадрирования: рамка нужной пропорции, палец двигает, ползунок зумит
function cropStep(file, rw, rh, outW, outH, title, okLabel) {
  return new Promise((resolve) => {
    const box = document.getElementById('ef-crop');
    const url = URL.createObjectURL(file);
    // ширина считается ОТ высоты, чтобы пропорция рамки всегда совпадала с выходным кадром
    box.innerHTML = `
      <p class="f-hint crop-title">${title}</p>
      <div class="crop-box" id="crop-area"
           style="aspect-ratio: ${rw} / ${rh}; width: min(100%, calc(44dvh * ${rw} / ${rh}))">
        <img id="crop-img" src="${url}" alt="" draggable="false">
      </div>
      <div class="crop-zoom-row">
        <span class="f-hint">Зум</span>
        <input id="crop-zoom" type="range" min="1" max="3" step="0.01" value="1" aria-label="Зум фото">
      </div>
      <div class="crop-actions">
        <button type="button" id="crop-ok" class="btn btn-primary btn-sm">${okLabel}</button>
        <button type="button" id="crop-cancel" class="btn btn-ghost btn-sm">Отмена</button>
      </div>`;
    box.scrollIntoView({ block: 'nearest' });

    const area = box.querySelector('#crop-area');
    const img = box.querySelector('#crop-img');
    let base = 1, scale = 1, x = 0, y = 0, iw = 0, ih = 0;

    const apply = () => {
      const s = base * scale;
      x = Math.min(0, Math.max(area.clientWidth - iw * s, x));
      y = Math.min(0, Math.max(area.clientHeight - ih * s, y));
      img.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    };

    img.onload = () => {
      iw = img.naturalWidth;
      ih = img.naturalHeight;
      base = Math.max(area.clientWidth / iw, area.clientHeight / ih);
      x = (area.clientWidth - iw * base) / 2;
      y = (area.clientHeight - ih * base) / 2;
      apply();
    };

    let drag = null;
    area.addEventListener('pointerdown', (e) => {
      drag = { px: e.clientX, py: e.clientY, ox: x, oy: y };
      area.setPointerCapture(e.pointerId);
    });
    area.addEventListener('pointermove', (e) => {
      if (!drag) return;
      x = drag.ox + (e.clientX - drag.px);
      y = drag.oy + (e.clientY - drag.py);
      apply();
    });
    const endDrag = (e) => {
      drag = null;
      try { area.releasePointerCapture(e.pointerId); } catch { /* уже отпущен */ }
    };
    area.addEventListener('pointerup', endDrag);
    area.addEventListener('pointercancel', endDrag);

    box.querySelector('#crop-zoom').addEventListener('input', (e) => {
      // зумим к центру рамки, а не к углу
      const s0 = base * scale;
      const cx = (area.clientWidth / 2 - x) / s0;
      const cy = (area.clientHeight / 2 - y) / s0;
      scale = Number(e.target.value);
      const s1 = base * scale;
      x = area.clientWidth / 2 - cx * s1;
      y = area.clientHeight / 2 - cy * s1;
      apply();
    });

    const finish = (result) => {
      URL.revokeObjectURL(url);
      box.innerHTML = '';
      resolve(result);
    };

    box.querySelector('#crop-cancel').addEventListener('click', () => finish(null));
    box.querySelector('#crop-ok').addEventListener('click', () => {
      const s = base * scale;
      const c = document.createElement('canvas');
      c.width = outW;
      c.height = outH;
      c.getContext('2d').drawImage(
        img,
        -x / s, -y / s, area.clientWidth / s, area.clientHeight / s,
        0, 0, outW, outH,
      );
      finish(c.toDataURL('image/jpeg', 0.9));
    });
  });
}

// ── Запись хайка (только Создатель) ────────────────────────

// уникальные маршруты с числом заходов, самые свежие сверху
function routeList() {
  const m = new Map();
  for (const k of HIKES) m.set(k.name, (m.get(k.name) || 0) + 1);
  return [...m.entries()].reverse();
}

let formPeaks = []; // вершины текущей формы: [{name, alt}]

function renderFormPeaks() {
  const box = document.getElementById('hf-peaks');
  box.innerHTML = formPeaks.length
    ? formPeaks.map((p, i) => `
        <span class="chip chip-${tierByAlt(p.alt)} peak-chip">
          ${esc(p.name)} <b>${p.alt ? p.alt + ' м · ' + TIER_LABEL[tierByAlt(p.alt)] : 'высота ?'}</b>
          <button type="button" class="chip-x" data-i="${i}" aria-label="Убрать ${esc(p.name)}">×</button>
        </span>`).join('')
    : '<p class="f-hint">Пока ни одной. Хайк можно записать и без вершины.</p>';
}

function hikeFormHTML(title, okLabel, extra = '') {
  const activeFirst = [...HEROES].sort((a, b) =>
    (a.status === 'gone') - (b.status === 'gone') || a.name.localeCompare(b.name, 'ru'));
  return `
    <h3 class="sheet-title">${title}</h3>

    <label class="f-label">Маршрут — тапни готовый или впиши новый</label>
    <div id="hf-routes" class="chips">${routeList().map(([name, n]) =>
      `<button type="button" class="role-chip" data-route="${esc(name)}">${esc(name)}${n > 1 ? ` <b>×${n}</b>` : ''}</button>`).join('')}</div>
    <input id="hf-name" class="f-input hf-name-input" placeholder="Например: Дзимба → Такао">
    <p id="hf-repeat" class="f-hint" hidden></p>

    <label class="f-label">Ссылка на презентацию (по желанию)</label>
    <input id="hf-deck" class="f-input" placeholder="https://..." inputmode="url" autocomplete="off">

    <label class="f-label">Вершины</label>
    <div id="hf-peaks" class="chips"></div>
    <button id="hf-add-peak" type="button" class="btn btn-ghost btn-sm">+ Добавить гору</button>
    <div id="hf-picker" class="picker" hidden></div>

    <label class="f-label">Кто ходил</label>
    <div id="hf-crew" class="chips">${activeFirst.map(h =>
      `<button type="button" class="role-chip" data-m="${h.id}" aria-pressed="false">${h.name}${h.nick ? ` «${h.nick}»` : ''}</button>`).join('')}</div>

    <button id="hf-save" class="btn btn-primary">${okLabel}</button>
    ${extra}`;
}

function openHikeForm() {
  formPeaks = [];
  openSheet(hikeFormHTML('Записать хайк', 'Записать хайк'));
  renderFormPeaks();
  wireHikeForm();

  document.getElementById('hf-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const data = readHikeForm();
    if (!data) return;
    btn.disabled = true;
    btn.textContent = 'Записываю…';
    try {
      await api('record_hike', data);
      await refreshFromDB();
      closeSheet();
      toast(`«${data.name}» записан — рейтинг обновился у ${data.member_ids.length} чел.`);
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

// ── Настройки ролей (только Создатель) ─────────────────────

function openSettings() {
  const counts = new Map();
  for (const h of HEROES) for (const r of h.roles) counts.set(r, (counts.get(r) || 0) + 1);
  openSheet(`
    <h3 class="sheet-title">Перечень ролей</h3>
    <p class="f-hint">Удаление снимает роль у всех, у кого она есть. Тапни ×, потом «точно?» для подтверждения.</p>
    <div id="rs-list" class="chips">${roleDict().map(r => `
      <span class="chip role-manage">${r} <b>${counts.get(r) || 0}</b>
        <button type="button" class="chip-x" data-r="${esc(r)}" aria-label="Удалить роль ${esc(r)}">×</button>
      </span>`).join('')}</div>
    <label class="f-label">Новая роль</label>
    <div class="add-row">
      <input id="rs-new" class="f-input" placeholder="Например: Штурман">
      <button id="rs-add" class="btn btn-ghost">Добавить</button>
    </div>
    <label class="f-label">Хайки — тапни, чтобы править</label>
    <div id="rs-hikes" class="hike-list">${HIKES.map(k => `
      <button type="button" class="hike-row-btn" data-k="${k.id}">
        <span>${esc(hikeLabel(k))}</span><b>${k.crew.length} чел.</b>
      </button>`).join('')}</div>`);

  const list = document.getElementById('rs-list');
  list.addEventListener('click', async (e) => {
    const x = e.target.closest('.chip-x');
    if (!x) return;
    if (!x.classList.contains('armed')) {
      list.querySelectorAll('.chip-x.armed').forEach(b => { b.classList.remove('armed'); b.textContent = '×'; });
      x.classList.add('armed');
      x.textContent = 'точно?';
      setTimeout(() => { if (x.isConnected) { x.classList.remove('armed'); x.textContent = '×'; } }, 3000);
      return;
    }
    x.disabled = true;
    try {
      await api('delete_role', { name: x.dataset.r });
      await refreshFromDB();
      toast(`Роль «${x.dataset.r}» удалена у всех`);
      haptic('success');
      openSettings();
    } catch (err) {
      toast('Не вышло: ' + err.message);
      haptic('error');
      x.disabled = false;
    }
  });

  document.getElementById('rs-add').addEventListener('click', async (e) => {
    const input = document.getElementById('rs-new');
    const name = input.value.trim();
    if (!name) { toast('Напиши название роли'); return; }
    e.currentTarget.disabled = true;
    try {
      await api('add_role', { name });
      await refreshFromDB();
      toast(`Роль «${name}» добавлена`);
      haptic('success');
      openSettings();
    } catch (err) {
      toast('Не вышло: ' + err.message);
      haptic('error');
      e.currentTarget.disabled = false;
    }
  });

  document.getElementById('rs-hikes').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-k]');
    if (!btn) return;
    const hike = HIKES.find(k => k.id === Number(btn.dataset.k));
    if (hike) openHikeEdit(hike);
  });
}

// ── Правка существующего хайка ─────────────────────────────

function openHikeEdit(hike) {
  formPeaks = hike.peaks.map(p => ({ name: p, alt: PEAKS[p] ?? null }));
  openSheet(hikeFormHTML('Править хайк', 'Сохранить хайк',
    '<button id="hf-del" type="button" class="btn btn-ghost btn-danger">Удалить хайк</button>'));
  document.getElementById('hf-name').value = hike.name;
  document.getElementById('hf-deck').value = hike.deck || '';
  document.querySelectorAll('#hf-crew [data-m]').forEach(b => {
    b.setAttribute('aria-pressed', String(hike.crew.includes(b.dataset.m)));
  });
  renderFormPeaks();
  wireHikeForm(hike.id);

  document.getElementById('hf-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const data = readHikeForm();
    if (!data) return;
    btn.disabled = true;
    btn.textContent = 'Сохраняю…';
    try {
      await api('update_hike', { id: hike.id, ...data });
      await refreshFromDB();
      closeSheet();
      toast(`«${data.name}» обновлён`);
      haptic('success');
    } catch (err) {
      toast('Не вышло: ' + err.message);
      haptic('error');
      btn.disabled = false;
      btn.textContent = 'Сохранить хайк';
    }
  });

  const del = document.getElementById('hf-del');
  del.addEventListener('click', async () => {
    if (!del.classList.contains('armed')) {
      del.classList.add('armed');
      del.textContent = 'Точно удалить? Хайк пропадёт у всех';
      setTimeout(() => { if (del.isConnected) { del.classList.remove('armed'); del.textContent = 'Удалить хайк'; } }, 3500);
      return;
    }
    del.disabled = true;
    try {
      await api('delete_hike', { id: hike.id });
      await refreshFromDB();
      toast('Хайк удалён');
      haptic('success');
      openSettings();
    } catch (err) {
      toast('Не вышло: ' + err.message);
      haptic('error');
      del.disabled = false;
    }
  });
}

// общая обвязка формы хайка: маршруты, пикер гор, чипы состава
function wireHikeForm(currentId = null) {
  const nameInput = document.getElementById('hf-name');
  const repeatNote = document.getElementById('hf-repeat');

  const syncRepeat = () => {
    const n = HIKES.filter(k => k.name === nameInput.value.trim() && k.id !== currentId).length;
    repeatNote.hidden = n === 0;
    if (n) repeatNote.textContent = `Такой маршрут уже есть — это будет ${n + 1}-й заход, в профилях сложится как ×${n + 1}.`;
  };
  nameInput.addEventListener('input', syncRepeat);
  syncRepeat();

  // тап по готовому маршруту: подставляем имя и его вершины
  document.getElementById('hf-routes').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-route]');
    if (!btn) return;
    const name = btn.dataset.route;
    nameInput.value = name;
    const src = [...HIKES].reverse().find(k => k.name === name);
    if (src) formPeaks = src.peaks.map(p => ({ name: p, alt: PEAKS[p] ?? null }));
    renderFormPeaks();
    syncRepeat();
    haptic('success');
  });

  // убрать вершину
  document.getElementById('hf-peaks').addEventListener('click', (e) => {
    const x = e.target.closest('.chip-x');
    if (!x) return;
    formPeaks.splice(Number(x.dataset.i), 1);
    renderFormPeaks();
  });

  // пикер гор
  const picker = document.getElementById('hf-picker');
  document.getElementById('hf-add-peak').addEventListener('click', () => {
    if (!picker.hidden) { picker.hidden = true; return; }
    const known = Object.entries(PEAKS).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    picker.innerHTML = `
      <input id="pk-search" class="f-input" placeholder="Поиск горы…" autocomplete="off">
      <div id="pk-list" class="pk-list">${known.map(([n, alt]) => `
        <button type="button" class="pk-item" data-n="${esc(n)}" data-a="${alt ?? ''}">
          <span>${esc(n)}</span>
          <b class="pk-tier-${tierByAlt(alt)}">${alt ? alt + ' м' : '? м'}</b>
        </button>`).join('')}</div>
      <p class="f-hint">Нет в списке? Впиши новую:</p>
      <div class="add-row">
        <input id="pk-new" class="f-input" placeholder="Название горы">
        <input id="pk-new-alt" class="f-input pk-alt-input" type="number" placeholder="метров">
      </div>
      <button id="pk-add-new" type="button" class="btn btn-ghost btn-block">Добавить эту гору</button>`;
    picker.hidden = false;

    document.getElementById('pk-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      picker.querySelectorAll('.pk-item').forEach(it => {
        it.hidden = !!q && !it.dataset.n.toLowerCase().includes(q);
      });
    });

    document.getElementById('pk-list').addEventListener('click', (e) => {
      const it = e.target.closest('.pk-item');
      if (!it) return;
      const name = it.dataset.n;
      if (!formPeaks.some(p => p.name === name)) {
        formPeaks.push({ name, alt: Number(it.dataset.a) || null });
        renderFormPeaks();
        haptic('success');
      }
      picker.hidden = true;
    });

    document.getElementById('pk-add-new').addEventListener('click', () => {
      const name = document.getElementById('pk-new').value.trim();
      const alt = Number(document.getElementById('pk-new-alt').value) || null;
      if (!name) { toast('Впиши название горы'); return; }
      if (!formPeaks.some(p => p.name === name)) formPeaks.push({ name, alt });
      renderFormPeaks();
      picker.hidden = true;
      haptic('success');
    });
  });

  document.getElementById('hf-crew').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-m]');
    if (!chip) return;
    chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
  });
}

function readHikeForm() {
  const name = document.getElementById('hf-name').value.trim();
  const member_ids = [...document.querySelectorAll('#hf-crew [aria-pressed="true"]')].map(b => b.dataset.m);
  const deck_url = document.getElementById('hf-deck').value.trim();
  if (!name) { toast('Дай маршруту имя'); return null; }
  if (!member_ids.length) { toast('Отметь, кто ходил'); return null; }
  if (deck_url && !/^https?:\/\//i.test(deck_url)) {
    toast('Ссылка должна начинаться с https://');
    return null;
  }
  return { name, peaks: formPeaks.filter(p => p.name), member_ids, deck_url: deck_url || null };
}

fabSet.addEventListener('click', openSettings);

// ── Встреча новичка ────────────────────────────────────────

function openWelcome() {
  openSheet(`
    <h3 class="sheet-title">Добро пожаловать в зал нишевых</h3>
    <p class="f-hint">Кто ты?</p>
    <button type="button" id="w-find" class="btn btn-primary">Я в команде — найду свою карточку</button>
    <button type="button" id="w-create" class="btn btn-ghost btn-block">Меня ещё нет — создать карточку</button>
    <button type="button" id="w-view" class="btn btn-ghost btn-block">Я зритель — просто посмотреть</button>`);

  document.getElementById('w-find').addEventListener('click', () => {
    closeSheet();
    toast('Найди себя и жми «Это моя карточка»', 4500);
    searchEl.focus();
  });

  document.getElementById('w-view').addEventListener('click', () => {
    localStorage.setItem('legends_viewer', '1');
    closeSheet();
    toast('Смотри на здоровье. Захочешь карточку — она ждёт.');
  });

  document.getElementById('w-create').addEventListener('click', openCreateSelf);
}

function openCreateSelf() {
  openSheet(`
    <h3 class="sheet-title">Твоя карточка</h3>
    <label class="f-label">Имя</label>
    <input id="cs-name" class="f-input" placeholder="Как тебя зовут">
    <label class="f-label">Прозвище (по желанию)</label>
    <input id="cs-nick" class="f-input" placeholder="Как тебя зовут в горах">
    <button type="button" id="cs-save" class="btn btn-primary">Создать карточку</button>
    <p class="f-hint">Начнёшь Новобранцем. Фото, инсту и фразу добавишь через «Редактировать».</p>`);

  document.getElementById('cs-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const name = document.getElementById('cs-name').value.trim();
    const nick = document.getElementById('cs-nick').value.trim();
    if (!name) { toast('Напиши имя'); return; }
    btn.disabled = true;
    btn.textContent = 'Создаю…';
    try {
      const res = await api('create_self', { name, nick });
      session.memberId = res.id;
      await refreshFromDB();
      closeSheet();
      toast('Карточка создана — открой её и жми «Редактировать»');
      haptic('success');
      const el = grid.querySelector(`.card[data-id="${res.id}"]`);
      if (el) openModal(res.id, el);
    } catch (err) {
      toast('Не вышло: ' + err.message);
      haptic('error');
      btn.disabled = false;
      btn.textContent = 'Создать карточку';
    }
  });
}

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

searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchEl.blur(); // Enter прячет клавиатуру
});

// экранная клавиатура должна закрываться при тапе мимо поля ввода
document.addEventListener('touchstart', (e) => {
  const a = document.activeElement;
  if (!a) return;
  const isField = a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT';
  const tappedField = e.target.closest?.('input, textarea, select');
  if (isField && !tappedField) a.blur();
}, { passive: true });

// ── Фильтр по ролям ────────────────────────────────────────

const roleDict = () => ROLES.length ? ROLES : [...new Set(HEROES.flatMap(h => h.roles))];

function buildRolesPanel() {
  const counts = new Map();
  for (const h of HEROES) for (const r of h.roles) counts.set(r, (counts.get(r) || 0) + 1);
  const roles = roleDict().map(r => [r, counts.get(r) || 0])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
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
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#0a0d13');
    tg.setBackgroundColor('#0a0d13');
  } catch { /* косметика не должна ронять апку */ }

  // сначала главное — узнать, кто это (с одним повтором на плохую сеть)
  if (tg.initData) {
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        session = await api('me');
        ok = true;
      } catch (e) {
        console.warn('auth', e);
        await new Promise(r => setTimeout(r, 1200));
      }
    }
    if (session.isAdmin) {
      fab.hidden = false;
      fabSet.hidden = false;
      render(); // показать админские кнопки в маршрутах
    } else if (ok && !session.memberId && localStorage.getItem('legends_viewer') !== '1') {
      openWelcome();
    }
  }

  // всё необязательное — строго после и в броне
  try { tg.disableVerticalSwipes?.(); } catch { /* старый клиент */ }
  try {
    const fsBtn = document.getElementById('fs-btn');
    if (fsBtn && typeof tg.requestFullscreen === 'function') {
      fsBtn.hidden = false;
      fsBtn.addEventListener('click', () => {
        try { tg.isFullscreen ? tg.exitFullscreen() : tg.requestFullscreen(); } catch { /* не умеет */ }
      });
      tg.onEvent?.('fullscreenChanged', () => {
        document.body.classList.toggle('tg-fullscreen', !!tg.isFullscreen);
      });
    }
  } catch { /* старый клиент */ }
}

// ── Старт: мгновенный рендер из запаса, потом живая база ───

buildRolesPanel();
renderStats();
render();
initTelegram();
refreshFromDB();

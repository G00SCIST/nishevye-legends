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

// подпись хайка: повторные заходы по тому же маршруту нумеруются
const hikeLabel = (k) => {
  const same = HIKES.filter(x => x.name === k.name);
  if (same.length < 2) return k.name;
  return `${k.name} · ${same.findIndex(x => x.id === k.id) + 1}-й заход`;
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
    inner += f('Роли — тыкай, чтобы выдать или снять', `<div id="ef-roles" class="chips">${roleDict().map(r =>
      `<button type="button" class="role-chip" data-r="${esc(r)}" aria-pressed="${h.roles.includes(r)}">${r}</button>`).join('')}</div>
      <p class="f-hint">Добавить новую роль в перечень можно в настройках (шестерёнка).</p>`);
  } else {
    inner += f('Прозвище', text('ef-nick', h.nick));
  }
  if (admin) {
    inner += f('Хайки — ходил / не ходил', `<div id="ef-hikes" class="chips">${HIKES.map(k =>
      `<button type="button" class="role-chip" data-k="${k.id}" aria-pressed="${k.crew.includes(h.id)}">${esc(hikeLabel(k))}</button>`).join('')}</div>
      <p class="f-hint">Ходил дважды по одному маршруту — отметь оба захода.</p>`);
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
  inner += f('Где сейчас', text('ef-place', h.place));
  inner += f('Коронная фраза', text('ef-quote', h.quote));
  inner += `<button id="ef-save" class="btn btn-primary">Сохранить</button>`;

  openSheet(inner);

  document.getElementById('ef-hikes')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-k]');
    if (!chip) return;
    chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
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
      hue: Number(document.querySelector('#ef-hue [aria-pressed="true"]')?.dataset.hue ?? h.hue),
    };
    if (admin) Object.assign(fields, {
      name: v('ef-name') || h.name,
      title: v('ef-title') || null,
      rank: v('ef-rank'),
      status: v('ef-status'),
      roles: [...document.querySelectorAll('#ef-roles [aria-pressed="true"]')].map(b => b.dataset.r),
    });
    btn.disabled = true;
    btn.textContent = 'Сохраняю…';
    try {
      await api('update_member', { id: h.id, fields });
      if (admin) {
        const hikeIds = [...document.querySelectorAll('#ef-hikes [aria-pressed="true"]')].map(b => Number(b.dataset.k));
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
  const portrait = await cropStep(file, '3 / 4', 900, 1200,
    'Шаг 1 из 2 · кадр для карточки (вертикальный)', 'Дальше: широкий кадр');
  if (!portrait) return;
  const wide = await cropStep(file, '3 / 2', 1200, 800,
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
function cropStep(file, aspect, outW, outH, title, okLabel) {
  return new Promise((resolve) => {
    const box = document.getElementById('ef-crop');
    const url = URL.createObjectURL(file);
    box.innerHTML = `
      <p class="f-hint crop-title">${title}</p>
      <div class="crop-box" id="crop-area" style="aspect-ratio: ${aspect}">
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
    area.addEventListener('pointerup', () => { drag = null; });
    area.addEventListener('pointercancel', () => { drag = null; });

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

function peakRowHTML(name = '', alt = '') {
  return `
    <div class="peak-row">
      <input class="f-input pk-name" list="peak-list" placeholder="Гора" value="${esc(name)}">
      <input class="f-input pk-alt" type="number" placeholder="Высота, м" value="${alt ?? ''}">
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
  const activeFirst = [...HEROES].sort((a, b) =>
    (a.status === 'gone') - (b.status === 'gone') || a.name.localeCompare(b.name, 'ru'));
  openSheet(`
    <h3 class="sheet-title">Править хайк</h3>
    <label class="f-label">Маршрут</label>
    <input id="hf-name" class="f-input" value="${esc(hike.name)}">
    <label class="f-label">Вершины и высоты</label>
    <div id="hf-peaks">${hike.peaks.length
      ? hike.peaks.map(p => peakRowHTML(p, PEAKS[p] ?? '')).join('')
      : peakRowHTML()}</div>
    <button id="hf-add-peak" type="button" class="btn btn-ghost btn-sm">+ ещё вершина</button>
    <label class="f-label">Кто ходил</label>
    <div id="hf-crew" class="chips">${activeFirst.map(h =>
      `<button type="button" class="role-chip" data-m="${h.id}" aria-pressed="${hike.crew.includes(h.id)}">${h.name}${h.nick ? ` «${h.nick}»` : ''}</button>`).join('')}</div>
    <button id="hf-save" class="btn btn-primary">Сохранить хайк</button>
    <button id="hf-del" type="button" class="btn btn-ghost btn-danger">Удалить хайк</button>
    <datalist id="peak-list">${Object.keys(PEAKS).map(p => `<option value="${esc(p)}">`).join('')}</datalist>
  `);

  wireHikeForm();

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

// общая обвязка формы хайка: добавление/удаление вершин, автоподстановка высот, чипы состава
function wireHikeForm() {
  const peaksBox = document.getElementById('hf-peaks');
  document.getElementById('hf-add-peak').addEventListener('click', () => {
    peaksBox.insertAdjacentHTML('beforeend', peakRowHTML());
  });
  peaksBox.addEventListener('click', (e) => {
    const x = e.target.closest('.row-x');
    if (x && peaksBox.children.length > 1) x.closest('.peak-row').remove();
  });
  peaksBox.addEventListener('input', (e) => {
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
}

function readHikeForm() {
  const name = document.getElementById('hf-name').value.trim();
  const peaks = [...document.querySelectorAll('#hf-peaks .peak-row')].map(r => ({
    name: r.querySelector('.pk-name').value.trim(),
    alt: Number(r.querySelector('.pk-alt').value) || null,
  })).filter(p => p.name);
  const member_ids = [...document.querySelectorAll('#hf-crew [aria-pressed="true"]')].map(b => b.dataset.m);
  if (!name) { toast('Дай маршруту имя'); return null; }
  if (!member_ids.length) { toast('Отметь, кто ходил'); return null; }
  return { name, peaks, member_ids };
}

fabSet.addEventListener('click', openSettings);

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
    } else if (ok && !session.memberId) {
      toast('Найди свою карточку и нажми «Это моя карточка»', 5000);
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

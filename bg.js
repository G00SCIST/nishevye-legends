'use strict';

// Живой фон: голографические горные хребты с контурным эхом, звёзды,
// скан-луч и редкие метеоры. Всё кодом — ни одного мегабайта видео.
// Уважает prefers-reduced-motion и засыпает, когда вкладка скрыта.

(() => {
  const canvas = document.getElementById('bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0;
  let stars = [];

  // хребты: от дальнего к ближнему; base/amp — доли высоты экрана
  const RIDGES = [
    { base: 0.62, amp: 0.050, speed: 4,  c: [140, 170, 230], glow: 0.10, fill: 0.045 },
    { base: 0.72, amp: 0.080, speed: 8,  c: [240, 180, 60],  glow: 0.11, fill: 0.050 },
    { base: 0.82, amp: 0.110, speed: 14, c: [120, 160, 220], glow: 0.14, fill: 0.065 },
    { base: 0.95, amp: 0.150, speed: 24, c: [240, 180, 60],  glow: 0.17, fill: 0.085 },
  ].map(r => ({
    ...r,
    p1: Math.random() * 6.28,
    p2: Math.random() * 6.28,
    p3: Math.random() * 6.28,
  }));

  const meteor = { active: false, nextAt: 6, x: 0, y: 0, len: 0, start: 0 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: Math.round(W / 15) }, () => ({
      x: Math.random() * W,
      y: Math.random() * H * 0.55,
      r: 0.4 + Math.random() * 1.2,
      tw: Math.random() * 6.28,
      sp: 0.4 + Math.random() * 1.4,
    }));
  }

  function ridgeY(r, x, t) {
    const k = 6.283 / W;
    const d = t * r.speed;
    return H * r.base - H * r.amp * (
      0.55 * Math.sin((x + d) * k * 1.7 + r.p1) +
      0.30 * Math.sin((x + d * 0.6) * k * 3.3 + r.p2) +
      0.15 * Math.sin((x + d * 1.4) * k * 5.9 + r.p3)
    );
  }

  function drawRidge(r, t) {
    const step = 10;
    const pts = [];
    for (let x = -step; x <= W + step; x += step) pts.push([x, ridgeY(r, x, t)]);
    const [cr, cg, cb] = r.c;

    // заливка вниз
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(W + step, H + 40);
    ctx.lineTo(-step, H + 40);
    ctx.closePath();
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${r.fill})`;
    ctx.fill();

    // светящаяся кромка + контурное эхо (голограмма)
    const line = (offset, width, alpha) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1] + offset);
      for (const [x, y] of pts) ctx.lineTo(x, y + offset);
      ctx.lineWidth = width;
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
      ctx.stroke();
    };
    line(0, 5, r.glow * 0.35);
    line(0, 1.4, r.glow * 1.5);
    line(9, 1, r.glow * 0.6);
    line(18, 1, r.glow * 0.3);
  }

  function drawMeteor(t) {
    if (!meteor.active) {
      if (t >= meteor.nextAt) {
        meteor.active = true;
        meteor.start = t;
        meteor.x = W * (0.35 + Math.random() * 0.6);
        meteor.y = H * (0.04 + Math.random() * 0.22);
        meteor.len = H * (0.28 + Math.random() * 0.2);
      }
      return;
    }
    const p = (t - meteor.start) / 1.0;
    if (p >= 1) {
      meteor.active = false;
      meteor.nextAt = t + 9 + Math.random() * 14;
      return;
    }
    const a = Math.sin(Math.PI * p) * 0.7;
    const dx = -0.85, dy = 0.42;
    const hx = meteor.x + dx * meteor.len * p;
    const hy = meteor.y + dy * meteor.len * p;
    const tail = meteor.len * 0.35;
    const g = ctx.createLinearGradient(hx, hy, hx - dx * tail, hy - dy * tail);
    g.addColorStop(0, `rgba(255,240,210,${a})`);
    g.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - dx * tail, hy - dy * tail);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = g;
    ctx.stroke();
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);

    // звёзды
    for (const s of stars) {
      const a = 0.16 + 0.4 * Math.abs(Math.sin(t * s.sp + s.tw));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, 6.283);
      ctx.fillStyle = `rgba(255,232,190,${a * 0.55})`;
      ctx.fill();
    }

    drawMeteor(t);

    for (const r of RIDGES) drawRidge(r, t);

    // скан-луч, медленно проходящий по голограмме
    const scanX = ((t * 36) % (W + 480)) - 240;
    const g = ctx.createLinearGradient(scanX - 90, 0, scanX + 90, 0);
    g.addColorStop(0, 'rgba(255,235,200,0)');
    g.addColorStop(0.5, 'rgba(255,235,200,0.028)');
    g.addColorStop(1, 'rgba(255,235,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(scanX - 90, 0, 180, H);
  }

  let rafId = null;
  const t0 = performance.now();

  function loop(now) {
    draw((now - t0) / 1000);
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (rafId === null && !reduced) rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  window.addEventListener('resize', () => { resize(); if (reduced) draw(0); });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  resize();
  if (reduced) draw(0); else start();
})();

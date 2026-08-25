// LEGENDS · единая edge-функция.
// Каждый вызов несёт initData из Telegram Mini App; подпись проверяется
// HMAC-ом с токеном бота (env BOT_TOKEN) — подделать личность нельзя.
// Публичный ключ ничего не пишет: все изменения идут только отсюда.

import { createClient } from 'npm:@supabase/supabase-js@2';

const BOT_TOKEN = Deno.env.get('BOT_TOKEN')!;
const supa = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

type TgUser = { id: number; first_name?: string; username?: string };

async function verifyInitData(initData: string): Promise<TgUser | null> {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const enc = new TextEncoder();
    const hmac = { name: 'HMAC', hash: 'SHA-256' } as const;
    const k1 = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), hmac, false, ['sign']);
    const secret = await crypto.subtle.sign('HMAC', k1, enc.encode(BOT_TOKEN));
    const k2 = await crypto.subtle.importKey('raw', secret, hmac, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', k2, enc.encode(dataCheckString));
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== hash) return null;

    const authDate = Number(params.get('auth_date') ?? 0);
    if (Date.now() / 1000 - authDate > 86400) return null; // сутки — и подпись протухла

    return JSON.parse(params.get('user') ?? 'null');
  } catch {
    return null;
  }
}

// поля, которые обычный участник может менять у своей карточки
const SELF_FIELDS = ['nick', 'quote', 'place', 'hue', 'photo_url'];
// поля, которые админ может менять у любой
const ADMIN_FIELDS = [...SELF_FIELDS, 'name', 'title', 'status', 'rank', 'roles', 'telegram_id'];

const pick = (obj: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => keys.includes(k)));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: { action?: string; initData?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const user = await verifyInitData(body.initData ?? '');
  if (!user?.id) return json({ error: 'auth failed' }, 401);

  const { data: adminRow } = await supa
    .from('admins').select('telegram_id').eq('telegram_id', user.id).maybeSingle();
  const isAdmin = !!adminRow;

  const { data: myMember } = await supa
    .from('members').select('id').eq('telegram_id', user.id).maybeSingle();
  const p = body.payload ?? {};

  switch (body.action) {
    case 'me':
      return json({ isAdmin, memberId: myMember?.id ?? null, tg: user.id });

    case 'claim': {
      // привязать себя к свободной карточке; админ может перепривязывать любую
      const id = String(p.member_id ?? '');
      const { data: target } = await supa
        .from('members').select('id, telegram_id').eq('id', id).maybeSingle();
      if (!target) return json({ error: 'not found' }, 404);
      if (!isAdmin && target.telegram_id && target.telegram_id !== user.id)
        return json({ error: 'already claimed' }, 409);
      if (!isAdmin && myMember && myMember.id !== id)
        return json({ error: 'you already have a card' }, 409);
      const { error } = await supa
        .from('members').update({ telegram_id: user.id }).eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    case 'update_member': {
      const id = String(p.id ?? '');
      const fields = isAdmin
        ? pick(p.fields as Record<string, unknown>, ADMIN_FIELDS)
        : pick(p.fields as Record<string, unknown>, SELF_FIELDS);
      if (!isAdmin && myMember?.id !== id) return json({ error: 'not yours' }, 403);
      if (!Object.keys(fields).length) return json({ error: 'nothing to update' }, 400);
      const { error } = await supa.from('members').update(fields).eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    case 'add_member': {
      if (!isAdmin) return json({ error: 'admin only' }, 403);
      const fields = pick(p.fields as Record<string, unknown>, ADMIN_FIELDS);
      const id = String(p.id ?? '').trim();
      if (!id || !fields.name) return json({ error: 'id and name required' }, 400);
      const { error } = await supa.from('members').insert({ id, ...fields });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    case 'record_hike': {
      if (!isAdmin) return json({ error: 'admin only' }, 403);
      const name = String(p.name ?? '').trim();
      const peaks = (p.peaks ?? []) as { name: string; alt?: number | null }[];
      const memberIds = (p.member_ids ?? []) as string[];
      if (!name || !memberIds.length) return json({ error: 'name and crew required' }, 400);

      for (const pk of peaks) {
        const { error } = await supa.from('peaks')
          .upsert({ name: pk.name.trim(), alt: pk.alt ?? null });
        if (error) return json({ error: error.message }, 500);
      }
      const { data: maxRow } = await supa
        .from('hikes').select('seq').order('seq', { ascending: false }).limit(1).maybeSingle();
      const { data: hike, error: hikeErr } = await supa
        .from('hikes').insert({ name, seq: (maxRow?.seq ?? 0) + 1 }).select('id').single();
      if (hikeErr) return json({ error: hikeErr.message }, 500);
      if (peaks.length) {
        const { error } = await supa.from('hike_peaks')
          .insert(peaks.map((pk) => ({ hike_id: hike.id, peak: pk.name.trim() })));
        if (error) return json({ error: error.message }, 500);
      }
      const { error: hmErr } = await supa.from('hike_members')
        .insert(memberIds.map((m) => ({ hike_id: hike.id, member_id: m })));
      if (hmErr) return json({ error: hmErr.message }, 500);
      return json({ ok: true, hike_id: hike.id });
    }

    case 'add_role': {
      if (!isAdmin) return json({ error: 'admin only' }, 403);
      const name = String(p.name ?? '').trim();
      if (!name) return json({ error: 'name required' }, 400);
      const { error } = await supa.from('roles').upsert({ name });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    case 'delete_role': {
      // удаляет роль из словаря и снимает её со всех участников
      if (!isAdmin) return json({ error: 'admin only' }, 403);
      const name = String(p.name ?? '').trim();
      if (!name) return json({ error: 'name required' }, 400);
      const { error } = await supa.rpc('strip_role', { role_name: name });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    case 'update_hike': {
      // полная правка хайка: имя, вершины (с высотами) и состав
      if (!isAdmin) return json({ error: 'admin only' }, 403);
      const id = Number(p.id);
      const name = String(p.name ?? '').trim();
      const peaks = (p.peaks ?? []) as { name: string; alt?: number | null }[];
      const memberIds = (p.member_ids ?? []) as string[];
      if (!id || !name || !memberIds.length) return json({ error: 'id, name and crew required' }, 400);
      for (const pk of peaks) {
        const { error } = await supa.from('peaks')
          .upsert({ name: pk.name.trim(), alt: pk.alt ?? null });
        if (error) return json({ error: error.message }, 500);
      }
      let r = await supa.from('hikes').update({ name }).eq('id', id);
      if (r.error) return json({ error: r.error.message }, 500);
      r = await supa.from('hike_peaks').delete().eq('hike_id', id);
      if (r.error) return json({ error: r.error.message }, 500);
      if (peaks.length) {
        r = await supa.from('hike_peaks')
          .insert(peaks.map((pk) => ({ hike_id: id, peak: pk.name.trim() })));
        if (r.error) return json({ error: r.error.message }, 500);
      }
      r = await supa.from('hike_members').delete().eq('hike_id', id);
      if (r.error) return json({ error: r.error.message }, 500);
      r = await supa.from('hike_members')
        .insert(memberIds.map((m) => ({ hike_id: id, member_id: m })));
      if (r.error) return json({ error: r.error.message }, 500);
      return json({ ok: true });
    }

    case 'set_member_hikes': {
      // галочки «ходил / не ходил» из карточки героя
      if (!isAdmin) return json({ error: 'admin only' }, 403);
      const memberId = String(p.member_id ?? '');
      const hikeIds = ((p.hike_ids ?? []) as unknown[]).map(Number).filter(Boolean);
      if (!memberId) return json({ error: 'member_id required' }, 400);
      let r = await supa.from('hike_members').delete().eq('member_id', memberId);
      if (r.error) return json({ error: r.error.message }, 500);
      if (hikeIds.length) {
        r = await supa.from('hike_members')
          .insert(hikeIds.map((hid) => ({ hike_id: hid, member_id: memberId })));
        if (r.error) return json({ error: r.error.message }, 500);
      }
      return json({ ok: true });
    }

    case 'set_photo': {
      // фото карточки: своё — любой, чужое — только админ
      const id = String(p.id ?? '');
      if (!isAdmin && myMember?.id !== id) return json({ error: 'not yours' }, 403);
      const m = String(p.data ?? '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!m) return json({ error: 'bad image' }, 400);
      const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      if (bytes.length > 1_500_000) return json({ error: 'image too big' }, 413);
      const path = `${id}.jpg`;
      const up = await supa.storage.from('photos').upload(path, bytes, { contentType: m[1], upsert: true });
      if (up.error) return json({ error: up.error.message }, 500);
      const { data: pub } = supa.storage.from('photos').getPublicUrl(path);
      const url = pub.publicUrl + '?t=' + Date.now();
      const r = await supa.from('members').update({ photo_url: url }).eq('id', id);
      if (r.error) return json({ error: r.error.message }, 500);
      return json({ ok: true, url });
    }

    case 'delete_hike': {
      if (!isAdmin) return json({ error: 'admin only' }, 403);
      const { error } = await supa.from('hikes').delete().eq('id', Number(p.id));
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    default:
      return json({ error: 'unknown action' }, 400);
  }
});

-- LEGENDS · схема базы. Запускается один раз (повторный запуск безопасен).

create table if not exists members (
  id text primary key,
  name text not null,
  nick text,
  title text,
  status text not null default 'active' check (status in ('active', 'gone')),
  rank text not null default 'recruit'
    check (rank in ('creator', 'deity', 'legend', 'mythic', 'knight', 'pathfinder', 'recruit')),
  roles text[] not null default '{}',
  place text,
  quote text,
  photo_url text,
  hue int not null default 210,
  telegram_id bigint unique,
  created_at timestamptz not null default now()
);

create table if not exists peaks (
  name text primary key,
  alt int
);

create table if not exists hikes (
  id bigint generated always as identity primary key,
  name text not null,
  seq int not null,
  happened_on date,
  created_at timestamptz not null default now()
);

create table if not exists hike_peaks (
  hike_id bigint not null references hikes(id) on delete cascade,
  peak text not null references peaks(name) on delete cascade,
  primary key (hike_id, peak)
);

create table if not exists hike_members (
  hike_id bigint not null references hikes(id) on delete cascade,
  member_id text not null references members(id) on delete cascade,
  primary key (hike_id, member_id)
);

create table if not exists admins (
  telegram_id bigint primary key,
  note text
);

-- RLS: каталог читается всеми, писать снаружи нельзя вообще —
-- все изменения идут через edge-функцию, которая сама проверяет подпись Телеграма.
alter table members enable row level security;
alter table peaks enable row level security;
alter table hikes enable row level security;
alter table hike_peaks enable row level security;
alter table hike_members enable row level security;
alter table admins enable row level security;

drop policy if exists "public read members" on members;
create policy "public read members" on members for select using (true);
drop policy if exists "public read peaks" on peaks;
create policy "public read peaks" on peaks for select using (true);
drop policy if exists "public read hikes" on hikes;
create policy "public read hikes" on hikes for select using (true);
drop policy if exists "public read hike_peaks" on hike_peaks;
create policy "public read hike_peaks" on hike_peaks for select using (true);
drop policy if exists "public read hike_members" on hike_members;
create policy "public read hike_members" on hike_members for select using (true);
-- admins без политик: снаружи таблица невидима.

insert into admins (telegram_id, note)
values (747400950, 'Киану — Создатель')
on conflict do nothing;

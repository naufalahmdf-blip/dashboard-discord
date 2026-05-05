-- =============================================================
-- TWS Discord Analytics — Supabase init schema
-- Jalankan SEKALI di SQL Editor project Supabase baru.
-- Idempotent: aman dijalankan ulang (pakai IF NOT EXISTS / OR REPLACE).
-- =============================================================

-- ── Extensions ─────────────────────────────────────────────────
create extension if not exists pgcrypto;  -- buat bcrypt password hash

-- ============================================================
-- 1. Tabel utama
-- ============================================================

-- 1.1 Dashboard users (login)
create table if not exists dashboard_users (
  id            bigserial primary key,
  email         text unique not null,
  password_hash text not null,
  role          text not null default 'user' check (role in ('admin','user')),
  created_at    timestamptz not null default now()
);

-- 1.2 Raw chat messages dari CSV Discord
create table if not exists chat_messages (
  id           bigserial primary key,
  username     text not null,
  msg_datetime timestamptz not null,
  content      text not null default 'EMPTY'
);
create index if not exists chat_messages_msg_datetime_idx on chat_messages (msg_datetime);
create index if not exists chat_messages_username_idx     on chat_messages (username);
-- trigram index supaya ILIKE %keyword% cepat (untuk search keluhan)
create extension if not exists pg_trgm;
create index if not exists chat_messages_content_trgm_idx on chat_messages using gin (content gin_trgm_ops);

-- 1.3 Hasil analisis sentimen harian (output AI)
create table if not exists sentiment_daily (
  stat_date     date primary key,
  pos           numeric default 0,
  neg           numeric default 0,
  pos_examples  jsonb default '[]'::jsonb,
  neg_examples  jsonb default '[]'::jsonb,
  note          text default ''
);

-- 1.4 Topik dominan harian (output AI)
create table if not exists daily_topics (
  stat_date date primary key,
  topics    jsonb default '[]'::jsonb
);

-- 1.5 Kategori keluhan (data manual)
create table if not exists complaint_categories (
  id         bigint primary key,
  sort_order int  not null default 1,
  theme      text not null,
  color      text default '#6366f1'
);

-- 1.6 Pesan keluhan per kategori (output AI)
create table if not exists complaint_messages (
  id          bigserial primary key,
  category_id bigint not null references complaint_categories(id) on delete cascade,
  msg_date    text default '',
  username    text default '',
  content     text default '',
  is_recent   boolean default false
);
create index if not exists complaint_messages_cat_idx on complaint_messages (category_id);

-- 1.7 Story arc (data manual)
create table if not exists story_arc (
  id          bigserial primary key,
  sort_order  int  not null default 1,
  phase       text not null,
  description text default '',
  color       text default '#6366f1'
);

-- 1.8 Root causes (data manual)
create table if not exists root_causes (
  id          bigserial primary key,
  sort_order  int  not null default 1,
  cause       text not null,
  percentage  numeric default 0,
  description text default ''
);

-- 1.9 Shadow accounts (data manual)
create table if not exists shadow_accounts (
  id             bigserial primary key,
  sort_order     int  not null default 1,
  username       text not null,
  display_name   text default '',
  pic            text default 'Adrian',
  character_desc text default '',
  role           text default 'support',
  msgs           int  default 0
);

-- ============================================================
-- 2. Materialized views (di-refresh tiap upload data)
-- ============================================================

-- Bersihkan dulu kalau sudah ada (urutan reverse karena dependensi)
drop materialized view if exists mv_all_time_users;
drop materialized view if exists mv_jon_daily;
drop materialized view if exists mv_suli_daily;
drop materialized view if exists mv_daily_stats;
drop materialized view if exists mv_monthly_stats;

-- 2.1 Statistik bulanan (jumlah pesan + user unik per bulan)
create materialized view mv_monthly_stats as
select
  to_char(date_trunc('month', msg_datetime at time zone 'UTC'), 'YYYY-MM') as month_key,
  count(*)                          as messages,
  count(distinct username)          as users
from chat_messages
where content <> 'EMPTY'
group by 1;
create unique index mv_monthly_stats_pk on mv_monthly_stats (month_key);

-- 2.2 Statistik harian
create materialized view mv_daily_stats as
select
  (msg_datetime at time zone 'UTC')::date as stat_date,
  count(*)                                as messages,
  count(distinct username)                as users
from chat_messages
where content <> 'EMPTY'
group by 1;
create unique index mv_daily_stats_pk on mv_daily_stats (stat_date);

-- 2.3 Pesan harian Suli (sesuaikan pattern username di WHERE)
create materialized view mv_suli_daily as
select
  (msg_datetime at time zone 'UTC')::date as stat_date,
  count(*)                                as msgs
from chat_messages
where lower(username) like '%suli%'
  and content <> 'EMPTY'
group by 1;
create unique index mv_suli_daily_pk on mv_suli_daily (stat_date);

-- 2.4 Pesan harian Jonathan (sesuaikan pattern)
create materialized view mv_jon_daily as
select
  (msg_datetime at time zone 'UTC')::date as stat_date,
  count(*)                                as msgs
from chat_messages
where (lower(username) like '%jonathan%' or lower(username) like '%jon_%' or lower(username) like 'jon%')
  and content <> 'EMPTY'
group by 1;
create unique index mv_jon_daily_pk on mv_jon_daily (stat_date);

-- 2.5 All-time user stats (total + first/last date + jumlah bulan aktif)
create materialized view mv_all_time_users as
select
  username,
  count(*)                                          as msgs,
  min((msg_datetime at time zone 'UTC')::date)      as first_date,
  max((msg_datetime at time zone 'UTC')::date)      as last_date,
  count(distinct to_char(msg_datetime at time zone 'UTC', 'YYYY-MM')) as months
from chat_messages
where content <> 'EMPTY'
group by username;
create unique index mv_all_time_users_pk on mv_all_time_users (username);

-- ============================================================
-- 3. RPC functions (dipanggil dari aplikasi)
-- ============================================================

-- 3.1 Refresh semua materialized view (dipanggil setelah upload CSV)
create or replace function refresh_stats() returns void
language plpgsql security definer as $$
begin
  refresh materialized view concurrently mv_monthly_stats;
  refresh materialized view concurrently mv_daily_stats;
  refresh materialized view concurrently mv_suli_daily;
  refresh materialized view concurrently mv_jon_daily;
  refresh materialized view concurrently mv_all_time_users;
exception when others then
  -- Kalau concurrently gagal (MV belum punya unique index / kosong), fallback non-concurrent
  refresh materialized view mv_monthly_stats;
  refresh materialized view mv_daily_stats;
  refresh materialized view mv_suli_daily;
  refresh materialized view mv_jon_daily;
  refresh materialized view mv_all_time_users;
end$$;

-- 3.2 Date range chat_messages
create or replace function get_chat_date_range()
returns table(min_date date, max_date date, total_msgs bigint)
language sql stable as $$
  select
    min((msg_datetime at time zone 'UTC')::date),
    max((msg_datetime at time zone 'UTC')::date),
    count(*)::bigint
  from chat_messages
  where content <> 'EMPTY'
$$;

-- 3.3 User stats untuk range tertentu
create or replace function get_user_stats(from_date date, to_date date)
returns table(username text, msgs bigint)
language sql stable as $$
  select username, count(*)::bigint as msgs
  from chat_messages
  where content <> 'EMPTY'
    and (msg_datetime at time zone 'UTC')::date between from_date and to_date
  group by username
  order by msgs desc
$$;

-- 3.4 Daily stats untuk range tertentu
create or replace function get_daily_stats_range(from_date date, to_date date)
returns table(stat_date date, messages bigint, users bigint)
language sql stable as $$
  select
    (msg_datetime at time zone 'UTC')::date,
    count(*)::bigint,
    count(distinct username)::bigint
  from chat_messages
  where content <> 'EMPTY'
    and (msg_datetime at time zone 'UTC')::date between from_date and to_date
  group by 1
  order by 1
$$;

-- 3.5 Suli daily untuk range tertentu
create or replace function get_suli_daily_range(from_date date, to_date date)
returns table(stat_date date, msgs bigint)
language sql stable as $$
  select
    (msg_datetime at time zone 'UTC')::date,
    count(*)::bigint
  from chat_messages
  where lower(username) like '%suli%'
    and content <> 'EMPTY'
    and (msg_datetime at time zone 'UTC')::date between from_date and to_date
  group by 1
  order by 1
$$;

-- 3.6 Jonathan daily untuk range tertentu
create or replace function get_jon_daily_range(from_date date, to_date date)
returns table(stat_date date, msgs bigint)
language sql stable as $$
  select
    (msg_datetime at time zone 'UTC')::date,
    count(*)::bigint
  from chat_messages
  where (lower(username) like '%jonathan%' or lower(username) like '%jon_%' or lower(username) like 'jon%')
    and content <> 'EMPTY'
    and (msg_datetime at time zone 'UTC')::date between from_date and to_date
  group by 1
  order by 1
$$;

-- ============================================================
-- 4. Admin pertama
-- ============================================================
-- ⚠ GANTI password di bawah ini ke password yang kamu mau
-- pgcrypto hash bcrypt → kompatibel dengan bcryptjs di server.js
insert into dashboard_users (email, password_hash, role)
values (
  'naufalahmdf@orovagroup.id',
  crypt('GantiPasswordIni123', gen_salt('bf', 10)),  -- ← GANTI password ini
  'admin'
)
on conflict (email) do update
  set password_hash = excluded.password_hash, role = 'admin';

-- Selesai. Kembali ke aplikasi & login pakai email/password di atas.

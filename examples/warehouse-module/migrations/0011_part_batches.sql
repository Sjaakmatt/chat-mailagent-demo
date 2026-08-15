-- 0011_part_batches
-- Onderdeel-batches: de organisatie legt per SKU vast welke fysieke batch (kleur
-- + label) in welke periode gold. Onderdelen wijzigen in de verkoop, dus het
-- magazijn moet de batch pakken die gold op de BESTELDATUM van de klant.
-- De agent resolvet per order-item de batch via start_date <= besteldatum
-- <= end_date (null = eeuwig), nieuwste start wint.

create table if not exists public.aios_part_batches (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  sku text not null,
  category text,
  color text not null default '#7c3aed',   -- hex
  label text not null,                       -- bv. "Q1 2026 (paars)"
  start_date date not null,
  end_date date,                             -- null = nog actueel
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Alleen via service-role benaderd; RLS aan zonder policies houdt
-- anon/authenticated buiten de deur.
alter table public.aios_part_batches enable row level security;

create index if not exists aios_part_batches_org_sku_idx
  on public.aios_part_batches (organization_id, sku, start_date);

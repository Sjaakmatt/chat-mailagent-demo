-- 0008_shipment_tasks
-- Magazijn-/verzendtaken: aangemaakt door de Execute-Workflow bij approve wanneer
-- de toegepaste beleidsregel een verzending impliceert. Voor de demo bevat de
-- taak een nep verzendlabel (tracking-code). Later komt echte verzending via een
-- mcp-shipping; de taak-tabel blijft dan de bron voor de magazijn-werkbak.

create table if not exists public.aios_shipment_tasks (
  id text primary key,
  organization_id text not null,
  review_item_id text,
  signal_id text,
  status text not null default 'OPEN',          -- OPEN | DONE | CANCELLED
  customer_email text,
  customer_name text,
  customer_address text,
  order_reference text,
  description text,
  items jsonb,
  label text,                                   -- (nep) tracking-code
  triggered_by_rule_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists aios_shipment_tasks_org_status_idx
  on public.aios_shipment_tasks (organization_id, status);

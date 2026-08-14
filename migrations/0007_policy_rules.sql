-- 0007_policy_rules
-- Beleidsregels per tenant voor de cockpit-editor + agent. v1: de agent matcht
-- op categorie (applies_to) en injecteert response_directive in de plan-prompt.
-- `conditions` is forward-compat voor een latere rijke conditie-engine (zodra
-- de classificatie meer feiten produceert). `action` blijft adviserend —
-- hard rule #1: nooit autonoom versturen, alles via REVIEW.

create table if not exists public.aios_policy_rules (
  id text primary key,
  organization_id text not null,
  name text not null,
  description text,
  applies_to text[] not null default '{}',
  response_directive text not null default '',
  priority integer not null default 100,
  enabled boolean not null default true,
  action text not null default 'review_queue',
  -- Generieke hook-vlag: maakt approve van een match een klant-specifieke
  -- vervolgtaak aan? De kern geeft 'm alleen door aan de afterExecute-
  -- domeinhook; wát de taak is, bepaalt de domeinmodule (zie examples/).
  creates_task boolean not null default false,
  conditions jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists aios_policy_rules_org_idx
  on public.aios_policy_rules (organization_id);

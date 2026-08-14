-- AIOS-datamodel voor de klant-agent (Build Document A7).
-- Doel-DB: het Supabase-project van de klant (NIET factumai-dashboard).
-- Additief + idempotent. RLS staat aan met GEEN policies: de service-role
-- (Worker) omzeilt RLS en houdt toegang; anon/authenticated krijgen niets.
--
-- Naamgeving: snake_case kolommen + `aios_`-prefix op de tabellen, idiomatisch
-- voor deze DB (vgl. mail_states). store.ts mapt naar de camelCase TS-contracten
-- in @factumai/agent-core.

do $$ begin
  create type aios_signal_status as enum ('NEW','PROCESSING','DONE','IGNORED','FAILED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type aios_review_status as enum ('PENDING','APPROVED','EDITED','REJECTED','EXECUTED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type aios_memory_scope as enum ('GLOBAL','CLIENT','PROCESS');
exception when duplicate_object then null; end $$;

do $$ begin
  create type aios_autonomy as enum ('REVIEW','AUTO');
exception when duplicate_object then null; end $$;

create table if not exists public.aios_signals (
  id              text primary key,
  organization_id text not null,
  domain          text not null,
  type            text not null,
  payload         jsonb not null default '{}'::jsonb,
  status          aios_signal_status not null default 'NEW',
  contact_id      text,
  deal_id         text,
  project_id      text,
  idempotency_key text unique,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz
);
create index if not exists aios_signals_org_status_idx on public.aios_signals (organization_id, status);
create index if not exists aios_signals_org_domain_idx  on public.aios_signals (organization_id, domain, received_at desc);

create table if not exists public.aios_review_items (
  id              text primary key,
  organization_id text not null,
  signal_id       text references public.aios_signals(id),
  kind            text not null,
  summary         text not null,
  proposed        jsonb not null default '{}'::jsonb,
  confidence      double precision,
  grounding       jsonb,
  status          aios_review_status not null default 'PENDING',
  decided_at      timestamptz,
  executed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists aios_review_items_org_status_idx on public.aios_review_items (organization_id, status, created_at desc);

create table if not exists public.aios_memory_entries (
  id              text primary key,
  organization_id text not null,
  scope           aios_memory_scope not null default 'CLIENT',
  pinned          boolean not null default false,
  title           text not null,
  body            text not null,
  -- Embeddings als jsonb tot pgvector aanstaat (Build Document A8/A12 — RAG is
  -- optioneel per casus); migreer later naar vector(1024) + hnsw-index.
  embedding       jsonb,
  source          text not null,
  source_ref      text,
  contact_id      text,
  deal_id         text,
  project_id      text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists aios_memory_entries_org_scope_idx on public.aios_memory_entries (organization_id, scope);

create table if not exists public.aios_automations (
  id              text primary key,
  organization_id text not null,
  name            text not null,
  trigger         text not null,
  schedule        text,
  autonomy        aios_autonomy not null default 'REVIEW',
  enabled         boolean not null default true,
  tool_scope      text[] not null default '{}',
  config          jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists aios_automations_org_enabled_idx on public.aios_automations (organization_id, enabled);

-- RLS aan zonder policies: deny-by-default voor anon/authenticated; de
-- service-role (Worker) omzeilt RLS en blijft werken.
alter table public.aios_signals        enable row level security;
alter table public.aios_review_items    enable row level security;
alter table public.aios_memory_entries  enable row level security;
alter table public.aios_automations     enable row level security;

-- 0019_decision_logs
-- Beslislog: één rij per agent-run. Legt vast wat de agent deed en waarom,
-- zodat een mens achteraf kan reconstrueren waarom een antwoord eruitzag zoals
-- het eruitzag — zonder de code te lezen.
--
-- Bewust geen vrije modeltekst: alle redenen komen uit code of uit een vast
-- veld. Een beslislog dat je niet kunt vertrouwen is erger dan geen beslislog.
--
-- Alleen via service-role benaderd → RLS aan zonder policies, net als de
-- overige aios_* tabellen.

create table if not exists public.aios_decision_logs (
  id              text primary key,
  organization_id text not null,
  signal_id       text not null references public.aios_signals(id) on delete cascade,
  review_item_id  text references public.aios_review_items(id) on delete set null,
  channel         text not null default 'mail',

  -- Poort. false = de run stopte hier en de rest is leeg.
  in_domain       boolean not null default true,
  domain_reason   text,

  category        text,
  specialist      text,
  -- {outcome, reason, degradedFrom?} — zie agent-core/outcomes.
  outcome         jsonb,

  steps           jsonb not null default '[]'::jsonb,
  sources         jsonb not null default '[]'::jsonb,
  ungrounded      jsonb not null default '[]'::jsonb,
  grounding       jsonb,
  confidence      double precision,

  created_at      timestamptz not null default now()
);

alter table public.aios_decision_logs enable row level security;

create index if not exists aios_decision_logs_org_created_idx
  on public.aios_decision_logs (organization_id, created_at desc);
-- Vanaf een ReviewItem naar het beslislog: de meest gebruikte route.
create index if not exists aios_decision_logs_review_idx
  on public.aios_decision_logs (review_item_id);
create index if not exists aios_decision_logs_signal_idx
  on public.aios_decision_logs (signal_id);
-- Snel de runs vinden die aandacht verdienen (poort dicht of gedegradeerd).
create index if not exists aios_decision_logs_attention_idx
  on public.aios_decision_logs (organization_id, in_domain, created_at desc);

-- 0018_unknown_intent_log
-- Fundering voor auto-discovery van nieuwe casus-typen.
--
-- Als de Router-classify onder de confidence-drempel blijft op ALLE
-- bestaande specialisten, landt de mail hier + wordt (voor nu) via
-- `escalate` naar een mens gestuurd. Wekelijks/dagelijks kan een
-- clustering-job (fase B) deze rijen samenbrengen tot cluster-rapporten
-- die de admin kan promoveren naar:
--   1. nieuwe MemoryEntry (kennis-gap),
--   2. nieuwe PolicyRule (regel-gap), of
--   3. experimentele specialist (nieuwe categorie).
--
-- Deze tabel is bewust light: geen queue, geen enum voor disposition
-- (still-being-designed). Embedding is optioneel — schrijven zonder
-- provider mag.

create table if not exists public.aios_unknown_intent_log (
  id                      text primary key,
  organization_id         text not null,
  signal_id               text not null references public.aios_signals(id) on delete cascade,
  -- Wat vond de Router? Vrije vorm (LLM-reasoning), voor audit + prompt-iteratie.
  router_reasoning        text not null default '',
  -- Top-N kandidaten met score, bv. [{"specialist":"complaint","score":0.32}, ...]
  router_top_candidates   jsonb not null default '[]'::jsonb,
  -- 1-2 zin samenvatting die de mail-triage-Haiku levert.
  mail_summary            text not null default '',
  -- Optioneel: embedding om later cross-organizaties te clusteren.
  -- Null wanneer geen embedding-provider actief. vector(1024) matcht met
  -- de rest van de RAG-stack (migratie 0003).
  mail_embedding          vector(1024),
  -- Wat gebeurde er met de mail: geen enum omdat het patroon nog groeit.
  --   answered_manually   — mens heeft handmatig geantwoord
  --   assigned_intent     — mens klasseerde als bestaande intent (leerdata)
  --   ignored             — geen actie
  --   promoted_to_memory  — er is een MemoryEntry uit gemaakt
  --   promoted_to_policy  — er is een PolicyRule uit gemaakt
  --   promoted_to_experimental_specialist — nieuwe specialist gebouwd
  final_disposition       text,
  disposition_notes       text,
  -- Als de mens een bestaand intent koppelde: welke.
  assigned_intent         text,
  created_at              timestamptz not null default now(),
  reviewed_at             timestamptz
);

create index if not exists aios_unknown_intent_log_org_created_idx
  on public.aios_unknown_intent_log (organization_id, created_at desc);

create index if not exists aios_unknown_intent_log_pending_idx
  on public.aios_unknown_intent_log (organization_id, created_at desc)
  where reviewed_at is null;

-- Similarity-index alleen als embedding gezet is; hnsw kan niet met NULLs
-- overweg, dus partial-index.
create index if not exists aios_unknown_intent_log_embedding_idx
  on public.aios_unknown_intent_log using hnsw (mail_embedding vector_cosine_ops)
  where mail_embedding is not null;

alter table public.aios_unknown_intent_log enable row level security;

comment on table public.aios_unknown_intent_log is
  'Auto-discovery log: mails die de Router niet met voldoende confidence op bestaande specialisten kon plaatsen. Voedt latere clustering + admin-goedkeuring om memory/policy/nieuwe specialist toe te voegen.';
comment on column public.aios_unknown_intent_log.router_top_candidates is
  'Top-N alternatieven met score: [{"specialist":"complaint","score":0.32}, ...]. Voor audit + prompt-iteratie.';
comment on column public.aios_unknown_intent_log.mail_embedding is
  'Optioneel; vector(1024) — matcht met de RAG-stack. Null als geen embedding-provider actief.';
comment on column public.aios_unknown_intent_log.final_disposition is
  'Vrije-vorm status: answered_manually | assigned_intent | ignored | promoted_to_memory | promoted_to_policy | promoted_to_experimental_specialist.';

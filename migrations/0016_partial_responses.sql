-- 0016_partial_responses
-- Multi-agent fan-in tussenlaag (blueprint fase 3).
--
-- Elke SpecialistWorkflow produceert per (signal, task) exact één rij hier.
-- De AggregatorWorkflow leest alle rijen voor een signal en weeft ze tot één
-- compound `aios_review_items`-rij. Deze tabel is bewust GEEN queue — het is
-- state; de fan-in-trigger loopt via de compound-orchestrator (poll/alarm) of
-- via een `partial_done`-signal in pgmq (optie B, later).
--
-- Contract: `PartialResponse` in @factumai/agent-core/contracts.
-- Snake_case in DB, camelCase in TS — mapping in aios/agents/aios/src/store.ts.

create table if not exists public.aios_partial_responses (
  id                text primary key,
  organization_id   text not null,
  signal_id         text not null references public.aios_signals(id) on delete cascade,
  task_id           text not null,
  intent            text not null,
  status            text not null default 'ok'
                    check (status in ('ok','needs_human','error')),
  resolved_refs     jsonb not null default '{}'::jsonb,
  facts             jsonb not null default '{}'::jsonb,
  proposed_content  text not null default '',
  confidence        double precision not null default 0
                    check (confidence >= 0 and confidence <= 1),
  grounding         jsonb not null default '[]'::jsonb,
  tool_calls        jsonb,
  reason            text,
  created_at        timestamptz not null default now(),

  -- Idempotency-grens: één partial per (signal, task). Herhaalde specialist-
  -- starts met dezelfde idempotencyKey mogen niet dubbel-rijden.
  unique (signal_id, task_id)
);

create index if not exists aios_partial_responses_signal_idx
  on public.aios_partial_responses (signal_id);

create index if not exists aios_partial_responses_org_created_idx
  on public.aios_partial_responses (organization_id, created_at desc);

-- Aggregator vraagt vaak: "hoeveel partials heeft signal X, en zijn ze klaar?"
create index if not exists aios_partial_responses_signal_status_idx
  on public.aios_partial_responses (signal_id, status);

alter table public.aios_partial_responses enable row level security;

comment on table public.aios_partial_responses is
  'Fan-in tussenlaag voor multi-agent: één rij per (signal, task). Aggregator produceert hieruit een compound ReviewItem.';
comment on column public.aios_partial_responses.status is
  'ok = klaar en bruikbaar; needs_human = specialist gaf op (bv. order niet ondubbelzinnig); error = tool-call permanent gefaald.';
comment on column public.aios_partial_responses.resolved_refs is
  'IDs die de specialist heeft bewezen (bv. {"orderId":"SO-2024-1287"}). Anders dan TaskDescriptor.refs (die is een hint).';
comment on column public.aios_partial_responses.facts is
  'Facts uit tool-calls — input voor de aggregator-prompt.';
comment on column public.aios_partial_responses.proposed_content is
  'Paragraaf-niveau deel-antwoord van de specialist; NOOIT een compleet mail-body.';
comment on column public.aios_partial_responses.grounding is
  'GroundingRef[] — elke numerieke/feitelijke claim gekoppeld aan de dekkende tool-call van dezelfde specialist-run.';

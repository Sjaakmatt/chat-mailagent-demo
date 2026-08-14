-- 0017_review_items_compound
-- Uitbreiden aios_review_items voor multi-agent compound antwoorden.
--
-- Backwards-compatible: single-intent ReviewItems blijven ongewijzigd
-- (compound = false, tasks = null). Alleen aggregator-output krijgt
-- compound = true + tasks-jsonb.
--
-- Contract: `CompoundMetadata` in @factumai/agent-core/contracts.

alter table public.aios_review_items
  add column if not exists compound boolean not null default false;

alter table public.aios_review_items
  add column if not exists tasks jsonb;

alter table public.aios_review_items
  add column if not exists precedence_intent text;

-- Cockpit-filter: alle openstaande compound-reviews, nieuwste eerst.
-- Partial index scheelt ruimte + is sneller op single-intent verkeer.
create index if not exists aios_review_items_compound_pending_idx
  on public.aios_review_items (created_at desc)
  where compound = true and status = 'PENDING';

comment on column public.aios_review_items.compound is
  'True wanneer deze ReviewItem het samengestelde antwoord is van een aggregator over N PartialResponses.';
comment on column public.aios_review_items.tasks is
  'CompoundTaskSummary[]: per-taak status/intent/confidence/summary voor cockpit-drilldown. Null wanneer compound=false.';
comment on column public.aios_review_items.precedence_intent is
  'SpecialistId van de intent die de toon van de complete mail bepaalt (bv. klacht overrulet neutrale status-vraag). Null = geen precedence.';

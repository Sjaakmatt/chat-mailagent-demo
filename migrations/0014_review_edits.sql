-- 0014_review_edits
-- Edit-historie per ReviewItem: elke expliciete "Concept opslaan" of beslissing
-- met inhoudelijke wijziging legt een snapshot vast van het concept (subject +
-- body), wie het opsloeg en wanneer. Zo zie je in de tijdlijn precies welke
-- reviewer wanneer wat heeft aangepast.
--
-- Niet bedoeld voor elke toetsaanslag (zou te ruisig zijn): alleen bij
-- expliciete save of bij decide (APPROVED/EDITED/REJECTED) als de tekst
-- afwijkt van de vorige snapshot.

create table if not exists public.aios_review_edits (
  id             text primary key default gen_random_uuid()::text,
  review_item_id text not null
                  references public.aios_review_items(id) on delete cascade,
  edited_by      text not null,
  edited_at      timestamptz not null default now(),
  subject        text,
  body           text,
  source         text not null default 'manual_save'
                  check (source in ('manual_save','decision'))
);

create index if not exists idx_aios_review_edits_item
  on public.aios_review_edits(review_item_id, edited_at);

comment on table public.aios_review_edits is
  'Snapshots van concepten per save/decision — audit-trail wie wat wanneer aanpaste.';

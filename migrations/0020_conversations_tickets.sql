-- 0020_conversations_tickets
-- Gesprekken, berichten en tickets (bouwbriefing §4 en §9.4).
--
-- Drie dingen die hier bij elkaar komen:
--
--   gesprek  Eén gesprek per chatsessie, één gesprek per mailthread. Dit is
--            ook de eenheid waarop de fair-use-grens wordt geteld — zonder
--            deze teller is die grens niet factureerbaar.
--   bericht  Elk in- en uitgaand bericht binnen een gesprek, kanaal-agnostisch.
--   ticket   Uitzoekwerk voor een mens, met een nummer dat de klant krijgt.
--
-- Eén gesprek kan meerdere tickets opleveren; een ticket hoort altijd bij één
-- gesprek. Het ticketnummer is wat de klant noemt als hij terugkomt, en dat
-- mag over kanalen heen werken: een ticket uit chat wordt per mail opgevolgd.
--
-- Alleen via service-role benaderd → RLS aan zonder policies.

-- ---------------------------------------------------------------------------
-- Gesprekken
-- ---------------------------------------------------------------------------
create table if not exists public.aios_conversations (
  id              text primary key,
  organization_id text not null,
  channel         text not null,               -- mail | chat | ...
  -- Sleutel waarop we een vervolgbericht aan hetzelfde gesprek koppelen:
  -- de mail-conversationId of de chat-sessie-id.
  external_ref    text,
  contact_email   text,
  -- Telt mee voor de fair-use-grens? Buiten domein en spam tellen niet mee
  -- (bouwbriefing §9.4), maar we bewaren het gesprek wel.
  billable        boolean not null default true,
  started_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

alter table public.aios_conversations enable row level security;

create index if not exists aios_conversations_org_started_idx
  on public.aios_conversations (organization_id, started_at desc);
-- Vervolgbericht → bestaand gesprek. Uniek per tenant+kanaal, zodat twee
-- gelijktijdige berichten niet twee gesprekken maken.
create unique index if not exists aios_conversations_external_idx
  on public.aios_conversations (organization_id, channel, external_ref)
  where external_ref is not null;
-- De fair-use-teller: hoeveel factureerbare gesprekken deze maand.
create index if not exists aios_conversations_billable_idx
  on public.aios_conversations (organization_id, billable, started_at);

-- ---------------------------------------------------------------------------
-- Berichten
-- ---------------------------------------------------------------------------
create table if not exists public.aios_messages (
  id              text primary key,
  organization_id text not null,
  conversation_id text not null references public.aios_conversations(id) on delete cascade,
  -- inbound = van de klant, outbound = van ons (agent of mens).
  direction       text not null check (direction in ('inbound', 'outbound')),
  body            text not null,
  -- Bij outbound: wie stuurde het. 'agent' of het e-mailadres van de medewerker.
  author          text,
  signal_id       text references public.aios_signals(id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table public.aios_messages enable row level security;

create index if not exists aios_messages_conversation_idx
  on public.aios_messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------
create table if not exists public.aios_tickets (
  id              text primary key,
  organization_id text not null,
  -- PREFIX-JJMM-NNNN, bv. PRO-2608-0042. Uniek per tenant; de klant noemt dit.
  number          text not null,
  conversation_id text references public.aios_conversations(id) on delete set null,
  review_item_id  text references public.aios_review_items(id) on delete set null,

  status          text not null default 'OPEN'
                  check (status in ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  -- Categorie uit de taxonomie, zodat de werkbak kan filteren.
  category        text,
  summary         text not null,

  -- Identificatie zoals bekend bij het aanmaken. Zonder e-mailadres is er geen
  -- terugkoppelkanaal — daarom staat het hier en niet alleen in het gesprek.
  contact_email   text,
  order_reference text,

  claimed_at      timestamptz,
  claimed_by      text,
  closed_at       timestamptz,
  closed_by       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.aios_tickets enable row level security;

create unique index if not exists aios_tickets_number_idx
  on public.aios_tickets (organization_id, number);
create index if not exists aios_tickets_org_status_idx
  on public.aios_tickets (organization_id, status, created_at desc);
create index if not exists aios_tickets_conversation_idx
  on public.aios_tickets (conversation_id);

-- ---------------------------------------------------------------------------
-- Ticketnummers: PREFIX-JJMM-NNNN, teller per tenant per maand
-- ---------------------------------------------------------------------------
--
-- De teller staat in de database en niet in de agent, omdat twee gelijktijdige
-- runs anders hetzelfde nummer zouden uitgeven. `on conflict do update` maakt
-- de ophoging atomair; de rij is meteen het slot.
create table if not exists public.aios_ticket_counters (
  organization_id text not null,
  period          text not null,               -- JJMM, bv. '2608'
  last_number     integer not null default 0,
  primary key (organization_id, period)
);

alter table public.aios_ticket_counters enable row level security;

create or replace function public.aios_next_ticket_number(
  p_org text,
  p_prefix text,
  p_period text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.aios_ticket_counters (organization_id, period, last_number)
  values (p_org, p_period, 1)
  on conflict (organization_id, period)
    do update set last_number = aios_ticket_counters.last_number + 1
  returning last_number into v_next;

  -- Vier cijfers is genoeg voor 9999 tickets per maand per tenant. Loopt 'ie
  -- daaroverheen, dan groeit het nummer gewoon mee in plaats van te botsen.
  return p_prefix || '-' || p_period || '-' || lpad(v_next::text, 4, '0');
end;
$$;

-- 0027_proposed_actions
--
-- Voorgestelde acties: een schrijfoperatie in een bronsysteem, klaargezet maar
-- niet uitgevoerd.
--
-- ## Het principe
--
-- De actie bestaat niet totdat een mens goedkeurt. Er staat niets in het
-- bronsysteem tot dat moment — geen concept-order, geen creditnota in status
-- "voorstel", geen werkticket dat productie al ziet staan.
--
-- Daardoor is er geen terugdraaipad nodig: er valt niets terug te draaien. Deze
-- tabel ís het voorstel; hij bestaat juist zodat er elders nog niets bestaat.
--
-- ## Waarom een eigen tabel en geen kolom op aios_review_items
--
-- Eén run kan meerdere acties opleveren, en een actie kan bestaan zonder
-- concept-antwoord. Als kolom zou het eerste niet passen en het tweede een leeg
-- ReviewItem afdwingen.
--
-- In de werkbak horen antwoord en actie wél op één scherm als ze uit dezelfde
-- run komen. Die koppeling loopt via `signal_id` (de run) en optioneel
-- `review_item_id` — niet via nesting.
--
-- ## Schrijfvolgorde
--
-- `review_item_id` verwijst naar `aios_review_items`. Bij chat betekent dat:
-- eerst het ReviewItem wegschrijven, dan deze rij, dan pas de bevestiging naar
-- de bezoeker. Dezelfde volgorde-val als bij `aios_tickets`; omgekeerd faalt de
-- insert en heeft de klant een bevestiging voor iets dat niet bestaat.

create table if not exists public.aios_proposed_actions (
  id              text primary key,
  organization_id text not null,

  -- Slug uit de typeregistratie in agent-core (`ACTION_TYPES`). Bewust geen
  -- foreign key naar een tabel: de registratie is code, want een agent mag
  -- kiezen uit een vaste lijst en er geen nieuwe operaties bij verzinnen.
  type            text not null,

  -- De volledige, uitvoerbare aanroep. Niet een beschrijving ervan: wat hier
  -- staat is letterlijk wat er straks naar de MCP gaat.
  payload         jsonb not null,

  -- Per veld in de payload: uit welke tool-call en welk bronbericht het komt.
  -- [{ "field": "address.city", "toolCallId": "...", "messageId": "..." }]
  --
  -- Bij een concept-antwoord kun je wegkomen met onderbouwing op berichtniveau.
  -- Bij een creditnota van 340 euro moet zichtbaar zijn waar de 340 vandaan
  -- komt én waar het factuurnummer vandaan komt. Elk veld is een bewering.
  evidence        jsonb not null default '[]'::jsonb,

  -- De systeemstaat waarop dit voorstel is gebaseerd, in toetsbare vorm.
  -- Bij goedkeuring wordt dit opnieuw opgehaald en vergeleken; wijkt het af,
  -- dan gaat het voorstel naar `verlopen` in plaats van uitgevoerd te worden.
  precondition    jsonb not null default '{}'::jsonb,

  -- Wat er verandert, in mensentaal. Dit is wat het scherm groot toont —
  -- niet de payload.
  impact          text not null,

  status          text not null default 'voorgesteld'
                  check (status in ('voorgesteld', 'goedgekeurd', 'uitgevoerd',
                                    'afgewezen', 'verlopen', 'mislukt')),

  -- De run die dit voortbracht; koppelt aan het beslislog van diezelfde run.
  signal_id       text not null references public.aios_signals(id) on delete cascade,
  -- Het concept-antwoord uit dezelfde run, als dat er is. Mag leeg: een actie
  -- kan bestaan zonder antwoord.
  review_item_id  text references public.aios_review_items(id) on delete set null,

  -- Gaat mee naar het doelsysteem waar dat ondersteund wordt, en vangt anders
  -- lokaal af. Nodig ook zónder terugdraaipaden: twee keer klikken, een dubbel
  -- tabblad, een netwerkfout halverwege het uitvoeren.
  idempotency_key text not null,

  -- Bij afwijzen de reden (het beste leersignaal dat we hebben), bij mislukt de
  -- foutmelding, bij verlopen de afwijking die is gevonden.
  reason          text,

  -- Wie het besluit nam, voor de auditlog.
  decided_by      text,
  decided_at      timestamptz,

  created_at      timestamptz not null default now(),
  -- Een voorstel dat blijft liggen vervalt vanzelf. Voorkomt dat iemand op
  -- maandag een voorstel van vorige week goedkeurt.
  expires_at      timestamptz not null
);

-- Eén voorstel per idempotentiesleutel per tenant. Dit is de vangnet-laag onder
-- de sleutel die naar het doelsysteem gaat: ook als de vendor er niets mee doet,
-- kan dezelfde actie hier niet twee keer ontstaan.
create unique index if not exists aios_proposed_actions_idem_idx
  on public.aios_proposed_actions (organization_id, idempotency_key);

-- De werkbak: openstaande voorstellen, oudste eerst — die verlopen als eerste.
create index if not exists aios_proposed_actions_open_idx
  on public.aios_proposed_actions (organization_id, status, expires_at)
  where status in ('voorgesteld', 'mislukt');

-- Alles uit één run bij elkaar, voor het gedeelde scherm met het antwoord.
create index if not exists aios_proposed_actions_signal_idx
  on public.aios_proposed_actions (signal_id);

-- Alleen via service-role benaderd; RLS aan zonder policies houdt
-- anon/authenticated buiten de deur. Zelfde patroon als de rest.
alter table public.aios_proposed_actions enable row level security;

comment on table public.aios_proposed_actions is
  'Klaargezette schrijfoperaties die pas bestaan in het bronsysteem nadat een '
  'mens ze goedkeurt. Bij goedkeuring wordt `precondition` opnieuw getoetst.';

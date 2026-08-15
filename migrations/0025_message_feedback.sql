-- 0025_message_feedback
--
-- Duim omhoog/omlaag van de bezoeker, per antwoord.
--
-- ## Waarom per bericht en niet per gesprek
--
-- Een oordeel over een heel gesprek levert een stemming op. Per antwoord weet
-- je wélk antwoord faalde, en dat is het verschil tussen een cijfer en een
-- diagnose. Een gesprek waarin drie antwoorden goed waren en het vierde fout,
-- krijgt aan het eind één duim omlaag en is daarna onbruikbaar.
--
-- ## Waarom een eigen tabel
--
-- `aios_messages` blijft zo wat het is: het gespreksverloop. Feedback komt
-- later, kan worden bijgesteld, en draagt velden die met het bericht zelf niets
-- te maken hebben (het eval-label van een medewerker). De sleutel is afgeleid
-- van het bericht-id, dus één stem per antwoord — opnieuw stemmen werkt de
-- bestaande rij bij in plaats van een tweede toe te voegen.
--
-- ## Waar dit heen gaat, en waar níét
--
-- NIET rechtstreeks de kennisbank in. Een duim omlaag zegt "ontevreden", niet
-- "dit was het goede antwoord" — je kunt er geen correctie uit leren. En de
-- vrije tekst komt van een anonieme bezoeker; die automatisch laten opnemen in
-- iets dat later in een prompt wordt geïnjecteerd, is precies het injectiepad
-- dat de rest van dit systeem met zorg dichthoudt (overal is bezoekerstekst
-- DATA, nooit instructie).
--
-- Wél twee andere kanten op, allebei via een mens in de werkbak:
--   1. Een medewerker schrijft een betere versie → die gaat als GOOD-voorbeeld
--      naar `aios_memory_entries` via het bestaande feedback-pad.
--   2. Een medewerker zet er een eval-label op → het geval wordt een testcase.
--      Dat vraagt alleen een oordeel en geen schrijfwerk, en loopt daarom in de
--      praktijk veel voller.

create table if not exists public.aios_message_feedback (
  -- Afgeleid van het bericht: fb-<messageId>. Eén stem per antwoord.
  id              text primary key,
  organization_id text not null,
  conversation_id text not null references public.aios_conversations(id) on delete cascade,
  message_id      text not null references public.aios_messages(id) on delete cascade,

  -- Het oordeel van de bezoeker.
  rating          text not null check (rating in ('up', 'down')),
  -- Optionele toelichting. Blijft DATA: nooit als instructie gebruiken.
  comment         text,

  -- Terug naar de run die dit antwoord maakte, zodat een medewerker kan zien
  -- wat de agent zag: welke categorie, welke bronnen, welk beleid.
  signal_id       text references public.aios_signals(id) on delete set null,
  review_item_id  text references public.aios_review_items(id) on delete set null,

  -- ── Het eval-deel: ingevuld door een mens, niet door de bezoeker ──────────
  -- NEW      = nog niet bekeken
  -- LABELED  = beoordeeld, bruikbaar als testcase
  -- DISMISSED= gezien, geen testcase (chagrijnige bezoeker, dubbele melding)
  triage_status   text not null default 'NEW'
                  check (triage_status in ('NEW', 'LABELED', 'DISMISSED')),
  -- Wát er misging. Categorisch, want dat is in vijf seconden te kiezen en
  -- levert een scherpere testcase op dan vrije tekst.
  --   routing   = verkeerde categorie gekozen
  --   gate      = onterecht geweigerd, of juist onterecht doorgelaten
  --   grounding = feit genoemd dat niet uit een bron kwam, of juist weggelaten
  --   identity  = vroeg om gegevens die al gegeven waren, of gaf ze zonder
  --   tone      = klopt inhoudelijk, maar niet hoe wij schrijven
  --   other     = iets anders; dan is `expected` verplicht om nuttig te zijn
  eval_label      text check (eval_label in
                    ('routing', 'gate', 'grounding', 'identity', 'tone', 'other')),
  -- Wat het had moeten zijn. Bij `routing` een categorie-slug, bij `gate` een
  -- ja/nee, verder vrije tekst. Kort houden: dit wordt een assertion.
  eval_expected   text,
  labeled_by      text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- De werklijst in de cockpit: openstaande feedback, nieuwste eerst.
create index if not exists aios_message_feedback_triage_idx
  on public.aios_message_feedback (organization_id, triage_status, created_at desc);

-- Alle feedback op één gesprek, voor het gespreksscherm.
create index if not exists aios_message_feedback_conv_idx
  on public.aios_message_feedback (conversation_id);

-- Alleen via service-role benaderd; RLS aan zonder policies houdt
-- anon/authenticated buiten de deur. Zelfde patroon als de rest.
alter table public.aios_message_feedback enable row level security;

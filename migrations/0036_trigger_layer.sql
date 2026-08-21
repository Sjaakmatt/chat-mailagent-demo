-- 0036_trigger_layer
-- De triggerlaag: de agent begint niet meer alleen bij een mail.
--
-- Twee dingen die de cron nodig heeft om zichzelf te kunnen herhalen zonder
-- dubbel werk te maken:
--
--   aios_automations.last_run_at   wanneer draaide deze automatisering voor het
--                                  laatst. Samen met het rooster bepaalt dat of
--                                  hij nu aan de beurt is.
--   aios_poll_cursors              waar we gebleven waren bij een bron die we
--                                  zelf periodiek bevragen.
--
-- De ontdubbeling zelf zit niet hier maar in de idempotency-sleutel van het
-- signaal (`auto:<naam>:<tijdsleuf>`, `poll:<module>:<bron>:<cursor>`): de
-- transactional outbox uit 0002 houdt er één over. Deze twee kolommen zijn er
-- om niet elke tik alles opnieuw op te halen — een tweede net, geen eerste.

-- ---------------------------------------------------------------------------
-- Wanneer draaide een automatisering voor het laatst
-- ---------------------------------------------------------------------------

alter table public.aios_automations
  add column if not exists last_run_at timestamptz;

-- Wat de cron elke tik vraagt: welke automatiseringen van deze organisatie
-- staan aan. `module` staat er sinds 0035 en hoort erbij, want straks draait
-- niet elke module zijn eigen automatiseringen op hetzelfde ritme.
create index if not exists aios_automations_due_idx
  on public.aios_automations (organization_id, module, enabled, last_run_at);

comment on column public.aios_automations.last_run_at is
  'Wanneer deze automatisering voor het laatst is uitgevoerd. Samen met `schedule` bepaalt dit of hij aan de beurt is; de echte ontdubbeling zit in de idempotency-sleutel van het signaal.';

comment on column public.aios_automations.schedule is
  'Rooster in UTC: hourly | daily@HH:MM | every:<n>m | every:<n>h. Bewust geen cron-expressie — zie packages/agent-core/src/triggers/index.ts.';

-- ---------------------------------------------------------------------------
-- Waar we gebleven waren bij een poll
-- ---------------------------------------------------------------------------
--
-- Eén rij per (organisatie, module, bron). De cursor is de hoogste waarde van
-- het cursorveld die we hebben gezien; alles daarna is nieuw.
--
-- `last_error` staat ernaast en niet in plaats van de cursor: een bron die niet
-- antwoordt hoort de cursor met rust te laten, zodat de volgende ronde het
-- gewoon opnieuw probeert vanaf hetzelfde punt. Een fout die de cursor vooruit
-- zet, slaat stilzwijgend rijen over.
create table if not exists public.aios_poll_cursors (
  organization_id text not null,
  module          text not null,
  source          text not null,
  cursor          text,
  last_run_at     timestamptz,
  last_error      text,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, module, source)
);

alter table public.aios_poll_cursors enable row level security;

-- Wat de cron ophaalt: alle cursors van deze organisatie in één query.
create index if not exists aios_poll_cursors_org_idx
  on public.aios_poll_cursors (organization_id, module);

comment on table public.aios_poll_cursors is
  'Waar een periodieke bron gebleven was. Eén rij per (organisatie, module, bron); de cursor is de hoogste geziene waarde van het cursorveld van die bron.';
comment on column public.aios_poll_cursors.last_error is
  'De laatste fout bij het ophalen. Staat naast de cursor, niet in plaats van: een bron die niet antwoordt laat de cursor staan zodat de volgende ronde vanaf hetzelfde punt verdergaat.';

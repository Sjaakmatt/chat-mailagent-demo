-- 0035_module_columns
-- Elke tabel die werk of kennis van één automatisering draagt, weet uit welk
-- proces het komt.
--
-- `aios_review_items` kreeg dat in 0030. De rest niet, en dat is een lek dat
-- pas zichtbaar wordt zodra module twee bestaat: een ticket, een gesprek, een
-- klaargezette actie en een beslislog horen bij één proces, maar niets in het
-- schema zegt welk. Een cockpit die tabt op module kan ze dan niet scheiden, en
-- een medewerker uit de ene afdeling ziet de werkvoorraad van de andere.
--
-- Waarom een default en niet nullable: alles wat er vandaag staat komt uit de
-- mailagent, en dat is klantenservice. Een schrijver die de kolom nog niet kent
-- (een klantrepo die deze migratie eerder draait dan zijn deploy) blijft
-- werken; nieuwe schrijvers zetten 'm expliciet.
--
-- Elke index begint op (organization_id, module, ...) en dekt daarna het
-- bestaande querypatroon van de lib die de tabel bevraagt. Module vooraan
-- omdat er straks per tab gefilterd wordt: staat 'ie achteraan, dan scant de
-- index alsnog het werk van de andere afdelingen.
--
-- Nummering: 0035 is het eerstvolgende vrije nummer boven wat klant-repo's al
-- gebruiken (zie migrations/README.md). De ruimte 0023-0029 blijft vrij.

-- ---------------------------------------------------------------------------
-- De kolommen
-- ---------------------------------------------------------------------------

alter table public.aios_tickets            add column if not exists module text;
alter table public.aios_conversations      add column if not exists module text;
alter table public.aios_proposed_actions   add column if not exists module text;
alter table public.aios_decision_logs      add column if not exists module text;
alter table public.aios_policy_rules       add column if not exists module text;
alter table public.aios_memory_entries     add column if not exists module text;
alter table public.aios_message_feedback   add column if not exists module text;
alter table public.aios_unknown_intent_log add column if not exists module text;
alter table public.aios_partial_responses  add column if not exists module text;
alter table public.aios_automations        add column if not exists module text;

-- Backfill vóór de not-null, en alleen waar niets staat: zo mag deze migratie
-- opnieuw draaien zonder een latere handmatige correctie terug te draaien.
update public.aios_tickets            set module = 'klantenservice' where module is null;
update public.aios_conversations      set module = 'klantenservice' where module is null;
update public.aios_proposed_actions   set module = 'klantenservice' where module is null;
update public.aios_decision_logs      set module = 'klantenservice' where module is null;
update public.aios_policy_rules       set module = 'klantenservice' where module is null;
update public.aios_memory_entries     set module = 'klantenservice' where module is null;
update public.aios_message_feedback   set module = 'klantenservice' where module is null;
update public.aios_unknown_intent_log set module = 'klantenservice' where module is null;
update public.aios_partial_responses  set module = 'klantenservice' where module is null;
update public.aios_automations        set module = 'klantenservice' where module is null;

alter table public.aios_tickets
  alter column module set default 'klantenservice',
  alter column module set not null;
alter table public.aios_conversations
  alter column module set default 'klantenservice',
  alter column module set not null;
alter table public.aios_proposed_actions
  alter column module set default 'klantenservice',
  alter column module set not null;
alter table public.aios_decision_logs
  alter column module set default 'klantenservice',
  alter column module set not null;
alter table public.aios_policy_rules
  alter column module set default 'klantenservice',
  alter column module set not null;
alter table public.aios_memory_entries
  alter column module set default 'klantenservice',
  alter column module set not null;
alter table public.aios_message_feedback
  alter column module set default 'klantenservice',
  alter column module set not null;
alter table public.aios_unknown_intent_log
  alter column module set default 'klantenservice',
  alter column module set not null;
alter table public.aios_partial_responses
  alter column module set default 'klantenservice',
  alter column module set not null;
alter table public.aios_automations
  alter column module set default 'klantenservice',
  alter column module set not null;

-- ---------------------------------------------------------------------------
-- Indexen — (organization_id, module, ...) plus het bestaande querypatroon
-- ---------------------------------------------------------------------------

-- ui/lib/tickets.ts: de ticketlijst, optioneel op status, nieuwste eerst.
create index if not exists aios_tickets_module_status_idx
  on public.aios_tickets (organization_id, module, status, created_at desc);

-- ui/lib/conversations.ts: de gesprekkenlijst, laatste beweging eerst.
create index if not exists aios_conversations_module_last_idx
  on public.aios_conversations (organization_id, module, last_message_at desc);
-- En de fair-use-teller, die per module te verantwoorden moet zijn.
create index if not exists aios_conversations_module_billable_idx
  on public.aios_conversations (organization_id, module, billable, started_at);

-- ui/lib/actions.ts + de werkbak: openstaande voorstellen, oudste vervaldatum
-- eerst. Partieel op dezelfde statussen als aios_proposed_actions_open_idx:
-- afgehandelde acties worden nooit zo opgevraagd.
create index if not exists aios_proposed_actions_module_open_idx
  on public.aios_proposed_actions (organization_id, module, status, expires_at)
  where status in ('voorgesteld', 'mislukt');

-- ui/lib/db.ts + de auditlog: beslislogs per proces, nieuwste eerst.
create index if not exists aios_decision_logs_module_created_idx
  on public.aios_decision_logs (organization_id, module, created_at desc);

-- agents/mail-agent steps.ts: de actieve regels van dit proces op priority.
create index if not exists aios_policy_rules_module_idx
  on public.aios_policy_rules (organization_id, module, enabled, priority);

-- packages/agent-core/src/memory: RAG haalt per scope/label op. Geheugen van
-- de ene afdeling hoort nooit in het antwoord van de andere te belanden, dus
-- module hoort in de index en niet alleen in een filter achteraf.
create index if not exists aios_memory_entries_module_scope_idx
  on public.aios_memory_entries (organization_id, module, scope);
create index if not exists aios_memory_entries_module_label_idx
  on public.aios_memory_entries (organization_id, module, label);

-- ui/lib/visitor-feedback.ts: de feedback-werklijst op triage-status.
create index if not exists aios_message_feedback_module_triage_idx
  on public.aios_message_feedback (organization_id, module, triage_status, created_at desc);

-- Router-misses per proces; de openstaande set is wat je naleest.
create index if not exists aios_unknown_intent_log_module_created_idx
  on public.aios_unknown_intent_log (organization_id, module, created_at desc);
create index if not exists aios_unknown_intent_log_module_pending_idx
  on public.aios_unknown_intent_log (organization_id, module, created_at desc)
  where reviewed_at is null;

-- agents/mail-agent store.ts: partials horen bij één signaal, en dat signaal
-- bij één proces.
create index if not exists aios_partial_responses_module_created_idx
  on public.aios_partial_responses (organization_id, module, created_at desc);

-- De triggerlaag (fase 2) leest de aangezette automatiseringen per proces.
create index if not exists aios_automations_module_enabled_idx
  on public.aios_automations (organization_id, module, enabled);

-- ---------------------------------------------------------------------------
-- Ticketnummers per module
-- ---------------------------------------------------------------------------
--
-- De teller liep per (organisatie, maand). Met twee modules delen die dezelfde
-- reeks, en dan springt het nummer dat de klant van klantenservice krijgt over
-- de nummers van administratie heen. Een reeks met gaten leest als "er is iets
-- kwijt", en bij een klant die zijn tickets telt is dat een gesprek dat je niet
-- wilt voeren.
--
-- De primaire sleutel wordt daarom (organization_id, module, period). Bestaande
-- rijen krijgen 'klantenservice' en houden hun stand, dus de lopende reeks
-- breekt niet.

alter table public.aios_ticket_counters add column if not exists module text;
update public.aios_ticket_counters set module = 'klantenservice' where module is null;
alter table public.aios_ticket_counters
  alter column module set default 'klantenservice',
  alter column module set not null;

do $$
begin
  -- Alleen omzetten als de sleutel nog de oude vorm heeft. Anders is deze
  -- migratie al gedraaid en is opnieuw droppen puur schade.
  if exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    where i.indrelid = 'public.aios_ticket_counters'::regclass
      and i.indisprimary
      and (
        select count(*) from unnest(i.indkey) as k where k <> 0
      ) = 2
  ) then
    alter table public.aios_ticket_counters
      drop constraint aios_ticket_counters_pkey;
    alter table public.aios_ticket_counters
      add primary key (organization_id, module, period);
  end if;
end $$;

-- De teller-RPC telt nu per module. Aparte parameter en geen default: een
-- aanroeper die de module vergeet hoort stuk te gaan, niet stilzwijgend uit de
-- klantenservice-reeks te trekken.
create or replace function public.aios_next_ticket_number(
  p_org text,
  p_prefix text,
  p_period text,
  p_module text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.aios_ticket_counters (organization_id, module, period, last_number)
  values (p_org, p_module, p_period, 1)
  on conflict (organization_id, module, period)
    do update set last_number = aios_ticket_counters.last_number + 1
  returning last_number into v_next;

  return p_prefix || '-' || p_period || '-' || lpad(v_next::text, 4, '0');
end;
$$;

-- Zelfde afweging als in 0020 en 0021: zonder deze revoke kan iedereen met de
-- anon-key de teller van een tenant ophogen en zo ticketnummers verbranden.
revoke all on function public.aios_next_ticket_number(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.aios_next_ticket_number(text, text, text, text)
  to service_role;

-- De drie-argument-variant blijft bestaan zolang er nog agents draaien die
-- 'm aanroepen — een deploy van de database en een deploy van de Worker vallen
-- nooit op dezelfde seconde. Hij trekt uit de klantenservice-reeks, want dat is
-- waar de oude aanroeper vandaan komt.
create or replace function public.aios_next_ticket_number(
  p_org text,
  p_prefix text,
  p_period text
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.aios_next_ticket_number(p_org, p_prefix, p_period, 'klantenservice');
end;
$$;

revoke all on function public.aios_next_ticket_number(text, text, text)
  from public, anon, authenticated;
grant execute on function public.aios_next_ticket_number(text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Categorie-slugs namespacen
-- ---------------------------------------------------------------------------
--
-- `applies_to` bevatte kale slugs. Die betekenen alleen iets binnen hun module:
-- 'facturatie' is in administratie een andere categorie dan in klantenservice,
-- en een regel die op de kale slug matcht zou straks in beide processen gelden.
--
-- Bestaande regels komen uit klantenservice, dus die krijgen dat voorvoegsel.
-- Alleen waarden zonder ':' worden aangeraakt, zodat de migratie opnieuw mag
-- draaien en al-gekwalificeerde sleutels ongemoeid blijven.
--
-- De code matcht een kale slug voorlopig nog in elke module (zie
-- `categoryKeyMatches` in agent-core), zodat een klant die deze migratie later
-- draait niet stilletjes zonder beleid komt te zitten.
update public.aios_policy_rules
set applies_to = (
  select array_agg(
    case when key like '%:%' then key else 'klantenservice:' || key end
    order by ord
  )
  from unnest(applies_to) with ordinality as t(key, ord)
)
where applies_to is not null
  and array_length(applies_to, 1) > 0
  and exists (select 1 from unnest(applies_to) as k where k not like '%:%');

comment on column public.aios_policy_rules.applies_to is
  'Categorie-sleutels in de vorm module:slug (bv. klantenservice:facturatie). Een kale slug is een regel van vóór 0035 en matcht nog in elke module.';

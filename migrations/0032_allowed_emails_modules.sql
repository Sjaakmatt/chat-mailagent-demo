-- 0032_allowed_emails_modules
-- Module-toewijzing per gebruiker: wie doet klantenservice, wie doet sales.
--
-- Waarom naast de rol en niet erin: de rol is de RANG (mag je goedkeuren), de
-- module is de AFDELING. Zou je dat samenvoegen, dan krijg je per afdeling drie
-- rollen — klantenservice_medewerker, klantenservice_teamleider,
-- klantenservice_kijker — en vermenigvuldigt elke nieuwe afdeling die lijst.
-- Bovendien doet bij een kleinere klant dezelfde persoon twee afdelingen; met
-- afdelingen-als-rol wordt dat een tweede account.
--
-- Dit is de MIDDELSTE van drie lagen. Toegang is de doorsnede van:
--   1. wat de tenant heeft afgenomen  (LICENSED_MODULES, config die wij zetten)
--   2. wat deze gebruiker mag doen    (deze kolom, door de beheerder van de klant)
--   3. wat zijn rol daar mag zien     (aios_role_grants)
-- Elke laag kan alleen beperken. `'*'` betekent nooit meer dan de laag erboven.
--
-- Contract: `resolveUserAccess` in @factumai/agent-core/access.

alter table public.allowed_emails
  add column if not exists modules text[] not null default array['*']::text[];

comment on column public.allowed_emails.modules is
  'Afdelingen waarin deze gebruiker werkt. ''*'' = alles wat de organisatie heeft afgenomen — nooit meer. Leeg = nergens toegang.';

-- Bestaande gebruikers houden wat ze hadden: de default is de joker, en die
-- wordt vanaf nu begrensd door de afname. Wie eerder alles zag bij een klant
-- die alleen klantenservice heeft, ziet dus voortaan alleen klantenservice —
-- dat is de bedoeling en geen regressie.
update public.allowed_emails
  set modules = array['*']::text[]
  where modules is null or cardinality(modules) = 0;

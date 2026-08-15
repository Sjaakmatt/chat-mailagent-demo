-- 0022_allowlist_domains
-- Twee dingen aan de cockpit-allowlist.
--
-- 1. `invited_by` toevoegen. De Toegang-pagina en /api/admin/allowed-emails
--    vroegen die kolom al op, maar 0004 maakte 'm nooit aan. Gevolg op elke
--    verse installatie: PostgREST geeft een fout op de select, de pagina toont
--    een lege lijst en de route een 500 — terwijl er wel degelijk mensen op de
--    allowlist staan.
--
-- 2. Domeinregels toestaan. Naast één adres per rij mag een rij nu ook een heel
--    domein zijn, geschreven als `@klant.nl`. Iedereen met een adres op dat
--    domein krijgt dan die rol. De meeste klanten bedoelen "iedereen bij ons"
--    en willen niet elke medewerker los uitnodigen.
--
--    Een persoonlijke rij wint van de domeinregel (zie agent-core/access), dus
--    je kunt iemand een andere rol geven of met `viewer` terugschroeven zonder
--    het domein aan te passen.
--
-- De check-constraint dwingt de vorm af. Belangrijk daarin: een kale `@` mag
-- niet, want dat zou iedereen met een willekeurig adres binnenlaten. Vandaar de
-- eis van minstens één punt in het domein.

alter table public.allowed_emails
  add column if not exists invited_by text;

comment on column public.allowed_emails.invited_by is
  'E-mail van de beheerder die deze regel toevoegde. Null voor de eerste admin, die met de hand in de tabel is gezet.';

-- Alles lowercase; de applicatie normaliseert al, dit trekt oude rijen bij.
update public.allowed_emails
   set email = lower(email)
 where email <> lower(email);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'allowed_emails_vorm_check'
  ) then
    alter table public.allowed_emails
      add constraint allowed_emails_vorm_check check (
        -- Eén adres: iets@iets.iets
        email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        -- of een heel domein: @iets.iets
        or email ~ '^@[^@[:space:]]+\.[^@[:space:]]+$'
      );
  end if;
end $$;

comment on table public.allowed_emails is
  'Wie de cockpit mag gebruiken. Een rij is één adres (jan@klant.nl) of een heel domein (@klant.nl); de persoonlijke rij wint.';

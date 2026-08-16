-- 0026_policy_handover_reason
--
-- Eén zin per beleidsregel: waarom komt hier een mens aan te pas.
--
-- ## Waarom dit naast `response_directive` staat en er niet in
--
-- `response_directive` stuurt het model dat het concept voor de medewerker
-- schrijft. Deze zin gaat rechtstreeks naar de klant, zonder model ertussen —
-- hij wordt letterlijk in de ticketbevestiging geplakt (`confirmationText`).
-- Dat verschil is het hele punt: een bevestiging die door een model heen is
-- geweest, kan een toezegging bevatten die niemand heeft afgesproken.
--
-- ## Waarom in de database en niet in de code
--
-- Dit is beleid, en beleid verandert. "Een wijziging op een lopende order
-- laten we altijd door een collega bevestigen" is een afspraak van één klant,
-- geen eigenschap van de agent. Morgen mag het misschien wél automatisch, en
-- dan hoort dat een veld te zijn dat iemand aanpast — geen deploy.
--
-- Daarom staat hier alleen de kolom. De teksten vult elke klant zelf, in de
-- cockpit of in een eigen migratie; het fundament schrijft geen tone-of-voice
-- voor.
--
-- Leeg laten mag: dan valt de bevestiging terug op de generieke zin uit
-- `CONFIRMATION.defaultHandoverReason`. Dat is precies het gedrag van vóór
-- deze migratie, dus bestaande regels veranderen niet vanzelf.
--
-- ## Wat een goede zin doet
--
-- Noem de afspraak, niet de beperking. "Hier kan ik niet over beslissen" gaat
-- over de agent; "dit bevestigen we altijd met een collega" gaat over hoe het
-- werkt. Hetzelfde feit, maar het tweede leest als beleid in plaats van als
-- een afhouder — en dat is precies wat het is.
--
-- Geef alleen een reden aan regels waarbij er ook echt een mens aan te pas
-- komt. Bij een categorie die de agent zelf afhandelt, zou de bezoeker uitleg
-- krijgen over een overdracht die niet plaatsvindt.
--
-- Let ook op het register: gebruik dezelfde aanspreekvorm als de rest van de
-- agent. Binnen één gesprek wisselen tussen "je" en "u" valt harder op dan
-- welke keuze dan ook.

alter table public.aios_policy_rules
  add column if not exists handover_reason text;

comment on column public.aios_policy_rules.handover_reason is
  'Eén zin voor de klant: waarom gaat dit langs een mens. Gaat letterlijk de '
  'ticketbevestiging in — geen model ertussen. Leeg = generieke terugval.';

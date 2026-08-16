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
-- laten we altijd door een collega bevestigen" is een afspraak van deze klant,
-- geen eigenschap van de agent. Morgen mag het misschien wél automatisch, en
-- dan hoort dat een veld te zijn dat iemand aanpast — geen deploy.
--
-- Leeg laten mag: dan valt de bevestiging terug op de generieke zin uit
-- `CONFIRMATION.defaultHandoverReason`. Dat is precies het gedrag van vóór
-- deze migratie, dus bestaande regels veranderen niet vanzelf.

alter table public.aios_policy_rules
  add column if not exists handover_reason text;

comment on column public.aios_policy_rules.handover_reason is
  'Eén zin voor de klant: waarom gaat dit langs een mens. Gaat letterlijk de '
  'ticketbevestiging in — geen model ertussen. Leeg = generieke terugval.';

-- ---------------------------------------------------------------------------
-- Demo-invulling
-- ---------------------------------------------------------------------------
--
-- Alleen voor de regels die daadwerkelijk naar een mens gaan. Een regel die de
-- agent zelf mag afhandelen heeft geen reden nodig, en er een geven zou
-- betekenen dat de bezoeker uitleg krijgt over een overdracht die niet
-- plaatsvindt.
--
-- Toon: dezelfde als de rest van de agent — "je", niet "u". Eén register per
-- gesprek; wisselen valt harder op dan welke keuze dan ook.
--
-- Vorm: noem de afspraak, niet de beperking. "Hier kan ik niet over beslissen"
-- gaat over de agent; "dit bevestigen we altijd met een collega" gaat over hoe
-- het werkt. Het tweede is hetzelfde feit en leest als beleid in plaats van
-- als een afhouder.

update public.aios_policy_rules set handover_reason =
  'Een wijziging op een lopend abonnement leggen we altijd even voor aan een '
  'collega — dan weet je zeker dat de nieuwe samenstelling en de facturatie '
  'kloppen voordat er iets verandert.'
where 'order_wijziging' = any(applies_to);

update public.aios_policy_rules set handover_reason =
  'Bij opzeggen of het beëindigen van een proefperiode kijkt altijd een '
  'collega mee, zodat we in één keer goed regelen wat er met de lopende '
  'termijn en je gegevens gebeurt.'
where 'opzegging_proef' = any(applies_to);

update public.aios_policy_rules set handover_reason =
  'Klachten handelen we niet automatisch af. Een collega leest je bericht '
  'zelf, zodat je een antwoord krijgt dat over jouw situatie gaat.'
where 'klacht' = any(applies_to);

update public.aios_policy_rules set handover_reason =
  'Voor een offerte op maat kijkt een collega naar wat je nodig hebt — een '
  'prijs die ik hier zou noemen, zou een slag in de lucht zijn.'
where 'offerte_aanvraag' = any(applies_to);

update public.aios_policy_rules set handover_reason =
  'Facturen en betalingen laten we altijd door een collega nakijken voordat '
  'we er iets over toezeggen.'
where 'facturatie' = any(applies_to);

update public.aios_policy_rules set handover_reason =
  'Een privacyverzoek behandelt altijd een collega persoonlijk — dat is niet '
  'iets wat we automatisch afhandelen.'
where 'gdpr_verzoek' = any(applies_to);

-- De overige regels krijgen bewust géén reden. Alle 21 staan op
-- `review_queue` (dat is de mailkant: niets gaat ongezien de deur uit), maar
-- dat betekent niet dat er in de chat een ticket ontstaat — dat hangt van de
-- uitkomst af. Voor een productvraag die de agent gewoon beantwoordt, zou een
-- overdrachtszin uitleg geven over iets dat niet gebeurt.

# Domeinblauwdruk: module `sales`

Bouwopdracht voor het tweede modulepakket. Vorm volgt `docs/MODULES.md`: descriptor in
`packages/agent-core/src/modules/sales.ts`, registratie in `ui/lib/modules/sales.ts`,
één regel in `registry.ts`. De lus blijft ongewijzigd en niets gaat autonoom naar buiten.

## 1. Waarom dit domein

Offertes en opvolging lekken tijd op de naad tussen inbox en CRM: prijs opzoeken,
klantgegevens overtypen, de derde opvolging vergeten. Een directeur betaalt hiervoor
omdat elke vergeten opvolging omzet is die niet binnenkomt, en omdat zijn CRM half
leeg staat. Het CRM lost dit niet op: het is opslag met workflowregels, het leest geen
mail, verrijkt geen bedrijf en schrijft geen offertetekst. Sales is een commodity:
iedereen bouwt dit. Het verschil zit in procesdiepte per klant, grounding op echte
systeemdata (geen prijs zonder systeemaanroep) en de mens die elke offerte ziet.

## 2. Triggers en signaalbronnen

| signal.domain | signal.type | bron | frequentie | payload-velden |
| --- | --- | --- | --- | --- |
| `mail` | `mail.received` | mail-MCP (M365) | poll 2 min | `messageId`, `from`, `subject`, `bodyText`, `attachments[]` |
| `web` | `form.submitted` | webhook websiteformulier | event | `email`, `company`, `phone`, `message`, `utm{}`, `pageUrl` |
| `crm` | `deal.created` | CRM-webhook | event | `dealId`, `stage`, `ownerId`, `contactId`, `value` |
| `crm` | `deal.stage_changed` | CRM-webhook | event | `dealId`, `fromStage`, `toStage`, `changedAt` |
| `crm` | `deal.poll_delta` | CRM-poll (adapters zonder webhook) | 15 min | `dealId[]`, `updatedSince`, `lastActivityAt` |
| `sales` | `quote.no_response` | cron | dagelijks 07:00 | `quoteId`, `dealId`, `sentAt`, `daysSilent`, `amount` |
| `sales` | `lead.dormant` | cron | wekelijks ma 07:00 | `contactId`, `dealId`, `daysSilent`, `lastStage` |
| `sales` | `pipeline.health` | cron | wekelijks ma 07:30 | `stageCounts{}`, `stalledDealIds[]`, `coverageRatio` |
| `sales` | `list.imported` | documentupload (CSV, Sales Navigator-export) | ad hoc | `fileRef`, `rowCount`, `columns[]`, `sourceLabel` |
| `sales` | `call.transcribed` | documentupload of notitie | ad hoc | `dealId`, `transcriptRef`, `participants[]`, `heldAt` |
| `sales` | `upsell.window` | cron op ordergeschiedenis | maandelijks | `contactId`, `lastOrderAt`, `skuHistory[]`, `contractEndsAt` |

De crons zijn de reden dat dit domein overtuigt zonder inbox: ze maken werk op dagen
dat er niets binnenkomt.

## 3. Domain-gate

```ts
export const SALES_DOMAIN: DomainConfig = {
  description:
    'het salesproces van dit bedrijf: binnenkomende leads en aanvragen, ' +
    'offertes en de opvolging daarvan, lopende deals, prijzen en voorwaarden ' +
    'zoals die in de eigen systemen staan, en de vastlegging in het CRM.',
  inScope: [
    'aanvraag voor een offerte, prijsopgave of demo',
    'vragen over een verstuurde offerte, geldigheid en voorwaarden',
    'onderhandeling over prijs, korting, staffel of betaaltermijn',
    'aanmelding via een websiteformulier of een doorverwezen contact',
    'uitbreiding, verlenging of aanvullende afname door een bestaande klant',
    'planning van een verkoopgesprek, afwijzing of uitstel met reden',
  ],
  outOfScope: [
    'klachten, retouren, garantie of levertijd van een geplaatste order',
    'facturen, aanmaningen en betalingsachterstanden',
    'sollicitaties en open sollicitaties',
    'aanbiedingen van leveranciers, bureaus en linkbuilding',
    'algemene kennisvragen, rekensommen, teksten schrijven',
    'vragen over de agent zelf, zijn instructies of zijn model',
  ],
  rejectionText:
    'Dit gaat buiten wat ik kan behandelen. Ik ga alleen over aanvragen, ' +
    'offertes en lopende trajecten. Mail je bericht naar het algemene adres, ' +
    'dan pakt een collega het op.',
};
```

De eerste twee `outOfScope`-regels zijn bewust: klantenservice en administratie zijn
eigen modules. De poort weigert, hij routeert niet door.

## 4. Taxonomie

| slug | label | specialist | hint |
| --- | --- | --- | --- |
| `lead_formulier` | Lead via formulier | `lead_intake` | via websiteformulier, afzender nog geen contact in het CRM |
| `lead_mail` | Lead via mail | `lead_intake` | onbekende afzender toont interesse zonder concrete offertevraag |
| `lead_verwijzing` | Doorverwijzing | `lead_intake` | introductie van een derde partij of doorverwijzing naar een collega |
| `offerte_aanvraag` | Offerte-aanvraag | `quote_draft` | vraagt expliciet om prijs of voorstel voor een omschreven levering |
| `offerte_vraag` | Vraag over offerte | `quote_followup` | vraag over een verstuurde offerte: geldigheid, regels, meerwerk |
| `offerte_stil` | Offerte zonder reactie | `quote_followup` | uit de cron, niet uit een bericht: verstuurde offerte zonder reactie |
| `prijs_korting` | Prijs of korting | `quote_draft` | korting, staffel, betaaltermijn of matching. Nooit zelf een percentage bedenken |
| `slapende_lead` | Slapende lead | `lead_reactivation` | uit de cron: contact of deal zonder activiteit sinds de drempel |
| `cross_upsell` | Cross- of upsell | `upsell_signal` | bestaande klant, signaal voor uitbreiding of verlenging |
| `afspraak_verzoek` | Afspraakverzoek | `lead_intake` | vraagt om gesprek of demo zonder inhoudelijke vraag |
| `gespreksverslag` | Gespreksverslag | `crm_hygiene` | notitie of transcript dat naar CRM-velden moet |
| `verloren_afwijzing` | Verloren of afgewezen | `crm_hygiene` | klant zegt nee of stelt uit. Reden vastleggen, niet doorduwen |
| `pipeline_signaal` | Pipelinesignaal | `pipeline_health` | uit de cron: afwijking in stages, dekking of doorlooptijd |
| `sales_overig` | Overig sales | `sales_escalate` | commercieel maar te vaag, of raakt meerdere categorieën |

## 5. Specialisten

Vorm exact volgens `IntentConfig`. `memoryScope` is overal `['GLOBAL','CLIENT','PROCESS']`.
`description` gaat in de router-prompt, de beslisstappen vormen de `systemPrompt`.

| id | displayName | description | beslisstappen (systemPrompt) | toolScope | memoryProcessTag | modelTierHint | confidenceThreshold | needsHitl |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `lead_intake` | Lead-intake | Onbekend contact meldt zich via formulier, mail of verwijzing; identificeert het bedrijf en legt een lead aan. | 1 haal naam, bedrijf, mail en vraag uit het bericht; 2 zoek het contact en maak geen tweede als het bestaat; 3 verrijk via KvK, geen match is geen reden om iets aan te nemen; 4 bevestig kort en stel één vervolgvraag; 5 noem nooit prijs of doorlooptijd | `crm.search_contact`, `crm.get_contact`, `kvk.lookup_company`, `enrich.get_company_profile`, `mail.get_thread` | `lead_intake` | `plan` | 0.80 | true |
| `lead_scoring` | Lead-scoring | Beoordeelt een lead of deal op HOT, WARM of COLD volgens het vaste raamwerk, uitsluitend op opgehaalde feiten. | 1 verzamel omvang, branche, herhaalbaar proces, volledigheid profiel en aanleiding, elk uit een tool-call; 2 HOT alleen bij automatiseerbaar proces én betekenisvolle omvang én compleet profiel én aanwijsbare aanleiding; 3 WARM bij redelijk potentieel met incomplete signalen; 4 COLD bij nauwelijks automatiseerbaar proces of koude bron; 5 ontbreekt een onderbouwing, kies WARM of COLD en schrijf op welk feit ontbrak, speculeer nooit omhoog; 6 geef per factor de dekkende `toolCallId` | `crm.get_contact`, `crm.get_deal`, `kvk.lookup_company`, `enrich.get_company_profile`, `crm.list_activities` | `lead_scoring` | `plan` | 0.90 | true |
| `quote_draft` | Concept-offerte | Zet een offerte-aanvraag om in een concept-offerte met regels, prijzen en voorwaarden uit de prijslijst. | 1 bepaal de gevraagde artikelen; 2 haal elke prijs op met `pricing.get_pricelist` en laat een ontbrekende regel leeg met markering open; 3 toets korting aan `pricing.get_discount_policy` en escaleer buiten de policy; 4 elk bedrag en elke datum heeft een `toolCallId` uit deze run, zonder dekking laat je het weg; 5 lever het `quote`-item plus een mailtekst zonder herhaling van de bedragen | `crm.get_contact`, `crm.get_deal`, `pricing.get_pricelist`, `pricing.get_discount_policy`, `erp.get_customer_history`, `quote.render_pdf` | `quote_draft` | `plan-heavy` | 0.92 | true |
| `quote_followup` | Offerte-opvolging | Volgt een verstuurde offerte op of beantwoordt een vraag erover, met status en geldigheid uit het systeem. | 1 haal de offerte op, stel status, bedrag en geldigheid vast; 2 bepaal welke poging dit is, na de derde stel je afsluiten voor; 3 verwijs naar de offerte, herhaal geen bedragen tenzij erom gevraagd; 4 bij meerwerk geen nieuwe prijs maar een herziene offerte | `crm.get_deal`, `crm.get_quote`, `crm.list_activities`, `mail.get_thread`, `pricing.get_pricelist` | `quote_followup` | `plan` | 0.85 | true |
| `lead_reactivation` | Reactivering | Pakt een lead of deal op die de stiltedrempel haalde en stelt één gerichte heropening voor. | 1 haal de laatste drie interacties op en stel vast waar het stil viel; 2 bij een expliciete afwijzing stel je niets voor en sluit je met reden; 3 anders één korte mail met een concrete aanleiding uit de historie; 4 toets `crm.get_consent` en stop bij bezwaar | `crm.get_contact`, `crm.get_deal`, `crm.list_activities`, `crm.get_consent`, `erp.get_customer_history` | `reactivation` | `plan` | 0.80 | true |
| `upsell_signal` | Cross- en upsell | Herkent bij een bestaande klant een aanleiding voor uitbreiding, verlenging of aanvullende afname. | 1 haal afname- en contracthistorie op; 2 benoem het signaal in één zin met de datum of het artikel dat het onderbouwt; 3 geen aanbod en geen prijs, het voorstel is een gesprek of een offerte-aanvraag; 4 zonder historie geen voorstel | `crm.get_contact`, `crm.get_deal`, `erp.get_customer_history`, `crm.get_contract`, `pricing.get_pricelist` | `upsell` | `plan` | 0.88 | true |
| `crm_hygiene` | CRM-vastlegging | Zet een gespreksverslag, notitie of afwijzing om in gestructureerde CRM-velden. | 1 haal alleen uit de tekst wat er letterlijk staat: stage, bedrag, sluitdatum, betrokkenen, bezwaren, vervolgstap; 2 vul geen veld dat niet genoemd is, leeg is geldig; 3 lever een `crm_update` met per veld oude en voorgestelde waarde; 4 schrijf geen tekst naar de klant | `crm.get_deal`, `crm.get_contact`, `crm.list_activities` | `crm_hygiene` | `classify` | 0.75 | true |
| `pipeline_health` | Pipeline-health | Analyseert de pipeline op stilstand, dekking en scheve stageverdeling en levert een takenlijst voor de eigenaar. | 1 werk uitsluitend met de aantallen uit `crm.list_deals`; 2 benoem per bevinding hoeveel deals het betreft en welke; 3 geen prognose in geld tenzij elk bedrag uit een dealrecord komt; 4 lever taken, geen advies | `crm.list_deals`, `crm.list_activities`, `crm.get_pipeline_config` | `pipeline` | `plan` | 0.80 | true |

`sales_escalate` valt terug op de bestaande `escalate`-config met `toolScope: []`.

## 6. Feiten en MCP-tools

| tool | doelsysteem | invoer | uitvoervelden | dataCategories | waarom nodig |
| --- | --- | --- | --- | --- | --- |
| `crm.search_contact` | HubSpot, Pipedrive, Teamleader, Odoo, Salesforce | `email`, `name`, `company` | `contactId`, `companyId`, `owner`, `lifecycleStage` | persoonsgegevens, commercieel | voorkomt dubbele leads |
| `crm.get_contact` | idem | `contactId` | `naam`, `email`, `functie`, `bron`, `consent` | persoonsgegevens | dekking voor persoonsgegevens in tekst |
| `crm.get_deal` | idem | `dealId` | `stage`, `amount`, `closeDate`, `owner`, `lastActivityAt` | commercieel | dekking voor stage, bedrag en datum |
| `crm.get_quote` | idem | `quoteId` | `status`, `sentAt`, `validUntil`, `lines[]`, `total` | commercieel, financieel | alleen de echte status en geldigheid |
| `crm.list_deals` | idem | `pipelineId`, `updatedSince` | `deals[]` met `stage`, `amount`, `lastActivityAt` | commercieel | enige bron voor pipelinecijfers |
| `crm.list_activities` | idem | `dealId` of `contactId` | `activities[]` met `type`, `at`, `summary` | commercieel | onderbouwt de stiltedrempel |
| `crm.get_consent` | idem | `contactId` | `optIn`, `objectedAt`, `unsubscribedAt`, `basis` | persoonsgegevens | blokkeert benadering na bezwaar |
| `crm.get_pipeline_config` | idem | `pipelineId` | `stages[]`, `probabilities{}` | operationeel | stagenamen nooit uit het hoofd |
| `pricing.get_pricelist` | Exact, Odoo, prijslijst | `sku[]`, `customerId`, `date` | `unitPrice`, `currency`, `validFrom`, `validUntil`, `priceListId` | financieel | zonder deze call geen prijs |
| `pricing.get_discount_policy` | prijslijst of ERP | `customerId`, `sku[]`, `volume` | `maxDiscountPct`, `staffel[]`, `approvalAbovePct` | financieel | korting is beleid, geen inschatting |
| `erp.get_customer_history` | Exact, Odoo | `customerId`, `sinceMonths` | `orders[]`, `skuHistory[]`, `omzetPerJaar` | financieel, commercieel | onderbouwt upsell en klantomvang |
| `crm.get_contract` | CRM of ERP | `customerId` | `startsAt`, `endsAt`, `noticeMonths`, `producten[]` | commercieel | verlengsignaal met datum |
| `kvk.lookup_company` | KvK-dataset | `naam`, `plaats`, `kvkNummer` | `kvkNummer`, `sbi[]`, `rechtsvorm`, `werkzamePersonen` | operationeel | omvang en branche herleidbaar maken |
| `enrich.get_company_profile` | verrijkingsdienst | `domein` of `kvkNummer` | `sector`, `medewerkersband`, `website` | commercieel | aanvullend, nooit enige bron voor HOT-score |
| `mail.get_thread` | bestaande mail-MCP | `conversationId` | `messages[]` | persoonsgegevens | context van de conversatie |
| `quote.render_pdf` | interne renderer | `quoteId`, `lines[]`, `template` | `fileRef`, `pageCount` | commercieel | het document dat de reviewer beoordeelt |
| `calendar.find_slot` | M365 | `ownerId`, `windowDays`, `duration` | `slots[]` | operationeel | geen tijdstip dat niet vrij is |

Nieuw te bouwen: `factumai-mcp-crm` (adapter per CRM, geen AI in de adapter),
`factumai-mcp-pricing`, `factumai-mcp-enrichment` (KvK plus verrijking, met logging per
opvraging) en `factumai-mcp-quote`. Herbruikbaar: `factumai-mcp-mail`, `-erp`, `-tickets`.

Prijs en korting krijgen een strengere regel: `quote_draft` mag een offerteregel met een
prijs alleen opnemen als er in dezelfde run een `GroundingRef` naar
`pricing.get_pricelist` of `pricing.get_discount_policy` bestaat. Ontbreekt die, dan
blijft de regel leeg en gaat het item met badge "prijs open" naar de werkbak. Een
verzonnen prijs is een aanbod waar de klant rechten aan ontleent.

## 7. ReviewItem-kinds en proposed-vorm

Kinds: `quote`, `follow_up_email`, `lead_score`, `crm_update`, `task`. De laatste twee
bestaan al; de eerste drie komen erbij (open union, geen contractwijziging nodig).

```jsonc
// quote
{ "quote": { "dealId": "...", "customer": { "name": "...", "contactId": "..." },
    "lines": [{ "sku": "...", "description": "...", "qty": 2, "unitPrice": 450,
                "discountPct": 0, "priceListId": "...", "open": false }],
    "subtotal": 900, "vatPct": 21, "validUntil": "2026-09-18", "fileRef": "..." },
  "email": { "subject": "...", "body": "..." },
  "classification": { "category": "offerte_aanvraag", "confidence": 0.93,
                      "specialist": "quote_draft" },
  "guardrail": { "ungroundedClaims": [], "openLines": [] } }

// follow_up_email
{ "subject": "...", "body": "...",
  "context": { "quoteId": "...", "sentAt": "...", "daysSilent": 9, "attempt": 2,
               "nextAction": "afsluiten_voorstellen" },
  "original": { "from": "...", "bodyText": "...", "messageId": "..." } }

// lead_score
{ "score": "WARM", "previous": "COLD",
  "factors": [{ "name": "omvang", "value": "18 werkzame personen", "toolCallId": "tc_..." }],
  "missing": ["geen aanwijsbare aanleiding"], "recommendation": "in cadans, niet bellen" }

// crm_update
{ "dealId": "...", "note": "...",
  "fields": [{ "name": "stage", "from": "Voorstel", "to": "Onderhandeling",
               "source": "gespreksverslag" }] }
```

`toCard`-viewmodel:

| kind | titel | ondertitel | badges |
| --- | --- | --- | --- |
| `quote` | bedrijfsnaam plus korte omschrijving | totaalbedrag en geldig tot | categorie, specialist, `n regels`, `prijs open` (alert), `korting x%` (alert) boven de policy |
| `follow_up_email` | onderwerp | contactpersoon en `x dagen stil` | categorie, `poging n`, `afsluiten voorgesteld` (alert) |
| `lead_score` | bedrijfsnaam | nieuwe en vorige score | `HOT` (alert), `WARM` (accent), `COLD` (neutral), `n feiten ontbreken` |
| `crm_update` | dealnaam | aantal gewijzigde velden | categorie, `stage gewijzigd` |
| `task` | takenkop | pipeline of eigenaar | `pipeline` |

## 8. Actietypen

Vorm van `ACTION_TYPES`. `channels` is overal `['mail']`; identificatie in sectie 9.

| type-slug | target {mcp, tool} | preconditionKind | impact | approverRole | amountThreshold | expiresAfterMinutes | payloadFields |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `lead_aanmaken` | `crm` / `create_contact` | `geen` | intern, nieuw record | reviewer | n.v.t. | 10080 | `name`, `email`, `company`, `source` |
| `leadscore_wegschrijven` | `crm` / `update_deal` | `dealstatus` | intern, prioritering | reviewer | n.v.t. | 4320 | `dealId`, `score`, `reason` |
| `activiteit_loggen` | `crm` / `log_activity` | `geen` | intern, dossieropbouw | reviewer | n.v.t. | 10080 | `dealId`, `type`, `summary` |
| `dealstage_bijwerken` | `crm` / `update_deal_stage` | `dealstatus` | intern, raakt forecast | reviewer | n.v.t. | 4320 | `dealId`, `toStage`, `reason` |
| `crm_velden_bijwerken` | `crm` / `update_deal` | `dealstatus` | intern, overschrijft velden | reviewer | n.v.t. | 4320 | `dealId`, `fields[]` |
| `offerte_vastleggen` | `crm` / `create_quote` | `prijsversie` | intern, offerte in concept | reviewer | n.v.t. | 1440 | `dealId`, `lines[]`, `validUntil` |
| `offerte_versturen` | `quote` / `send_quote` | `prijsversie` | extern, bindend aanbod | reviewer | 10000 | 720 | `quoteId`, `toEmail`, `subject`, `body`, `amount` |
| `korting_toepassen` | `crm` / `apply_discount` | `prijsversie` | extern, verlaagt marge | reviewer | 1000 | 720 | `quoteId`, `discountPct`, `amountEffect`, `reason` |
| `opvolgmail_versturen` | `mail` / `send_reply` | `dealstatus` | extern, klantcontact | reviewer | n.v.t. | 2880 | `messageId`, `toEmail`, `subject`, `body` |
| `salescall_inplannen` | `calendar` / `create_event` | `geen` | extern, agenda-uitnodiging | reviewer | n.v.t. | 1440 | `contactId`, `startsAt`, `duration`, `subject` |
| `deal_sluiten_verloren` | `crm` / `close_deal` | `dealstatus` | intern, haalt omzet uit forecast | admin | n.v.t. | 4320 | `dealId`, `lostReason`, `competitor` |
| `lead_uitschrijven` | `crm` / `suppress_contact` | `geen` | stopt benadering | reviewer | n.v.t. | 1440 | `contactId`, `reason`, `requestedAt` |

Het fundament moet twee dingen uitbreiden. `PRECONDITION_KINDS` krijgt `dealstatus`
(velden `dealId`, `stage`, `amount`) en `prijsversie` (`quoteId`, `priceListId`,
`total`, `validUntil`), elk met een reader die bij goedkeuring hervalideert. Verandert
de prijslijst tussen voorstellen en goedkeuren, dan verloopt het voorstel in plaats van
dat er een oude prijs uitgaat. En de drempels: boven `amountThreshold` vereisen
`korting_toepassen` en `offerte_versturen` een `admin`.

## 9. Uitkomsten en identificatie

| uitkomst | wanneer |
| --- | --- |
| `kennis` | standaardvoorwaarden of werkwijze, uit de kennisbasis, zonder klantspecifieke gegevens |
| `systeem` | status van een bestaande deal of offerte uit het CRM, bij een geïdentificeerd contact |
| `taak` | offerte, korting, opvolging, score, CRM-mutatie: alles waar een mens naar kijkt |
| `onbekend` | commercieel bericht zonder duidelijke vraag: doorvragen, geen ticket |

Identificatie is strenger dan bij klantenservice, want commerciële gegevens zijn
concurrentiegevoelig. **Zwak** (afzenderadres) volstaat voor `lead_aanmaken` en
`activiteit_loggen`. **Bevestigd** (adres komt overeen met een CRM-contact) is vereist
voordat er iets over een bestaande deal of offerte wordt gedeeld. **Gematcht** (contact
hoort aantoonbaar bij het bedrijf van de deal en het maildomein komt overeen met het
klantdomein) is vereist voor `offerte_vastleggen`, `offerte_versturen`,
`korting_toepassen` en `deal_sluiten_verloren`. Concreet: prijzen, kortingen en marges
gaan nooit naar een adres dat niet gematcht is.

## 10. Schermen en tabellen

Nav-items op `salesModule` (`order: 20`, icoon `TrendingUp`):

| href | pagina | inhoud |
| --- | --- | --- |
| `/leads` | Leadlijst | filter op score, bron en eigenaar; kolommen bedrijf, contact, score, dagen stil |
| `/leads/[id]` | Leaddetail | profiel, verrijkingsfeiten met bron en datum, scoregeschiedenis |
| `/offertes` | Offertelijst | status, bedrag, geldig tot, dagen stil, opvolgpoging |
| `/offertes/[id]` | Offertedetail | regels met prijsbron, PDF-preview, versies, grounding-paneel |
| `/pipeline` | Pipeline | stageverdeling, stilstaande deals, dekking; leest alleen uit de cache |

`detailHref`: `quote` en `follow_up_email` naar `/offertes/{id}`, `lead_score` en
`crm_update` naar `/leads/{id}`, `task` naar `/pipeline`. Elke pagina begint met
`requireModulePage(SALES_MODULE.id)`, elke route-handler met
`requireModule(SALES_MODULE.id, "reviewer")`.

Nieuwe tabellen (migratie `0035_sales_module.sql`), RLS aan zonder policies:

| tabel | kolommen | indexen |
| --- | --- | --- |
| `aios_sales_leads` | `id` pk, `organization_id`, `crm_contact_id`, `crm_company_id`, `email`, `company_name`, `kvk_number`, `source`, `owner`, `score`, `score_reason`, `enriched_at`, `consent_state`, `last_activity_at` | `(organization_id, score, last_activity_at desc)`; uniek `(organization_id, email)`; `(organization_id, kvk_number)` |
| `aios_sales_quotes` | `id` pk, `organization_id`, `crm_quote_id`, `deal_id`, `lead_id`, `status`, `total_amount`, `price_list_id`, `valid_until`, `sent_at`, `followup_count`, `file_ref`, `review_item_id` | `(organization_id, status, valid_until)`; `(organization_id, sent_at)` waar `status='sent'`; uniek `(organization_id, crm_quote_id)` |
| `aios_sales_score_events` | `id` pk, `organization_id`, `lead_id`, `score`, `previous_score`, `factors` jsonb, `missing` jsonb, `decided_by`, `signal_id`, `created_at` | `(organization_id, lead_id, created_at desc)` |
| `aios_sales_price_snapshots` | `id` pk, `organization_id`, `quote_id`, `price_list_id`, `lines` jsonb, `tool_call_id`, `captured_at` | `(organization_id, quote_id, captured_at desc)` |
| `aios_sales_cadences` | `id` pk, `organization_id`, `lead_id`, `deal_id`, `kind`, `step`, `next_run_at`, `paused_reason` | `(organization_id, next_run_at)` waar `paused_reason is null` |

`aios_sales_price_snapshots` is wat de preconditie `prijsversie` bij goedkeuring
vergelijkt. Zonder snapshot is "de prijs is niet veranderd" een aanname.

Bestaande tabellen die een `module`-kolom nodig hebben: `aios_signals`,
`aios_proposed_actions`, `aios_decision_logs`, `aios_policy_rules`,
`aios_memory_entries`, `aios_tickets`. `aios_review_items` heeft hem al (0030). Overal
`text null`, backfill naar `'klantenservice'`, index `(organization_id, module,
created_at desc)`.

## 11. Demo-scenario's

Fictieve data, adressen op `example.com`.

1. **Formulier naar lead en score.** Van der Meer Installatietechniek vult het formulier
   in, `p.dekker@example.com`, 28 medewerkers, vraag over offerteafhandeling.
   `lead_intake` legt de lead aan, `lead_scoring` haalt KvK op en zet HOT met vier
   dekkende feiten. Voorstellen: `lead_aanmaken`, `leadscore_wegschrijven`.
2. **Score blijft bewust WARM.** `info@example.com` mailt "stuur eens info". Geen
   bedrijfsnaam, geen KvK-match, geen aanleiding. `lead_scoring` kiest WARM met
   `missing`: geen aanwijsbaar proces, geen aanleiding.
3. **Offerte-aanvraag naar concept.** Bakkerij Nootenboom vraagt 12 stuks `TR-450` plus
   montage. De artikelregels komen uit de prijslijst, montage staat er niet in en blijft
   open. Het item krijgt de badge "prijs open"; de reviewer vult aan.
4. **Korting boven de drempel.** Kroon Logistiek vraagt 15% bij 40 stuks; de policy geeft
   maximaal 8%. `quote_draft` stelt 8% voor met de staffel als onderbouwing en zet het
   verzoek als notitie voor de eigenaar. `korting_toepassen` boven de drempel vraagt een
   `admin`.
5. **Cron zonder mail.** `quote.no_response` vuurt op `Q-2026-0184` van Terpstra Kozijnen:
   negen dagen stil, poging twee, geldigheid over vijf dagen. De mail verwijst naar de
   geldigheidsdatum zonder het bedrag te herhalen.
6. **Cron met bezwaar.** `lead.dormant` vuurt op een contact bij Rensen Groothandel.
   `crm.get_consent` geeft `objectedAt` gevuld. Geen mail, alleen een `task` met de reden.
7. **Bewuste escalatie.** Een advocaat mailt namens Havenbedrijf De Wal over betaaltermijn
   90 dagen en een boetebeding. Buiten de policy en juridisch: `sales_escalate` maakt geen
   concept, alleen een ticket met de bijlage.
8. **Gespreksverslag naar CRM.** Na een gesprek met Nieuwenhuis Techniek levert
   `crm_hygiene` een `crm_update` met drie velden en laat "budget" leeg, want het is niet
   genoemd.

## 12. Analytics en waarde

| KPI | definitie | bron |
| --- | --- | --- |
| Leads per bron per week | telling per `source` | `aios_sales_leads` |
| Scoreverdeling | aandeel HOT, WARM, COLD plus verschuiving week op week | `aios_sales_score_events` |
| Tijd tot eerste reactie | eerste goedgekeurde uitgaande actie minus binnenkomst signaal | `aios_signals`, `aios_proposed_actions` |
| Offertes per status | concept, verstuurd, verlopen, gewonnen | `aios_sales_quotes` |
| Opvolgdekking | aandeel verstuurde offertes met minstens één opvolging binnen de cadans | `aios_sales_quotes` |
| Verlopen zonder opvolging | `valid_until` gepasseerd bij `followup_count = 0` | `aios_sales_quotes` |
| Goedkeuringsratio per kind | goedgekeurd, bewerkt, afgewezen | `aios_review_items`, `aios_review_edits` |
| Bewerkingsgraad op prijsregels | aandeel `quote`-items waar een reviewer een bedrag corrigeerde | `aios_action_edits` |
| Open prijsregels | aandeel offertes met een regel buiten de prijslijst | `guardrail.openLines` |
| Verloren met reden | aandeel gesloten deals met ingevulde `lostReason` | `aios_proposed_actions` |

De bewerkingsgraad op prijsregels is de belangrijkste kwaliteitsmeter: loopt hij op, dan
klopt de prijslijstkoppeling niet.

## 13. Risico's en grenzen

Een mens kijkt altijd naar elke offerte, elke korting, elke mail naar een extern adres,
elke afsluiting van een deal en elke HOT-score. Een verkeerd verstuurde prijs is duur op
twee manieren: het is een aanbod waar de klant zich op kan beroepen, en het is niet terug
te nemen zonder gezichtsverlies. Vandaar de harde koppeling tussen prijs en
`GroundingRef`, de `prijsversie`-preconditie en de korte houdbaarheid op offertetypen.

AVG bij verrijking: KvK-data is openbaar en mag, maar een profiel over een persoon
opbouwen is verwerking met een eigen grondslag. Verrijk op bedrijfsniveau, niet op
persoonsniveau, en leg per opvraging bron, moment en reden vast. Scrapen van profielen
zit niet in scope; een geïmporteerde export bevat alleen velden die de gebruiker zelf
exporteerde, met vastgelegde herkomst. Bezwaar en uitschrijving worden vóór elke
uitgaande actie getoetst via `crm.get_consent`; `objectedAt` blokkeert het voorstel, niet
alleen de mail.

EU AI Act: geautomatiseerde scoring raakt personen zodra de score op persoonskenmerken
rust. Daarom rust de score uitsluitend op bedrijfskenmerken, wordt elke score gelogd met
model, factoren, ontbrekende feiten en dekkende tool-calls, en beslist de score niets:
hij prioriteert een werkbak die een mens leest. Leg de risicoclassificatie vast met
beoogd gebruik, databronnen en de vorm van menselijk toezicht.

Bewust niet geautomatiseerd: onderhandelen over prijs, toezeggen van doorlooptijden of
opleverdata, een offerte versturen zonder goedkeuring, contacten uit een gekochte lijst
benaderen, deals automatisch sluiten, en zelfstandig een prijslijst aanpassen.

## 14. Bouwvolgorde

**Stap 1, kleinste demonstreerbare versie.** Descriptor, cockpitregistratie, één regel in
`registry.ts`, `SALES_DOMAIN`, de categorieën `lead_formulier`, `offerte_aanvraag`,
`offerte_stil` en `sales_overig`, de specialisten `lead_intake` en `lead_scoring`,
`factumai-mcp-crm` met alleen `search_contact`, `get_contact`, `create_contact` en
`log_activity`, de tabellen `aios_sales_leads` en `aios_sales_score_events`, het scherm
`/leads`, en de acties `lead_aanmaken`, `leadscore_wegschrijven`, `activiteit_loggen`.
Trigger: het websiteformulier. Draait op FactumAI zelf als tenant zero, en demonstreert
zonder dat er een prijslijst bestaat.

**Stap 2.** `factumai-mcp-pricing`, `quote_draft`, kind `quote`, `aios_sales_quotes` en
`aios_sales_price_snapshots`, de preconditie `prijsversie`, `/offertes/[id]` met
grounding-paneel, en de acties `offerte_vastleggen`, `offerte_versturen`,
`korting_toepassen`.

**Stap 3.** De crons `quote.no_response` en `lead.dormant`, de specialisten
`quote_followup` en `lead_reactivation`, `aios_sales_cadences`, `crm.get_consent`, kind
`follow_up_email`.

**Stap 4.** `crm_hygiene` en `pipeline_health`, CRM-webhooks en poll-adapter,
`/pipeline`, en de KPI's in de cockpit.

**Stap 5.** `upsell_signal`, `crm.get_contract`, `erp.get_customer_history` op maandcron,
en de tweede en derde CRM-adapter.

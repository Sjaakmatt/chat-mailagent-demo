# Bouwopdrachten voor Claude Code

Per fase één opdracht om te plakken in Claude Code, in de repo
`mail-agent-fundament`. Werk fase voor fase. Begin geen fase voordat de vorige
groen is en je hem hebt bekeken.

## Werkafspraken voor alle fases

Zet dit blok bovenaan elke sessie, of beter: neem het op in `CLAUDE.md` zodat je
het niet elke keer hoeft te herhalen.

```
Werkregels voor deze verbouwing:
- Werk op een branch per fase: fase-0-hygiene, fase-1-modulepakket, enzovoort.
- Stop-and-validate. Aan het eind van elke stap: `pnpm -r typecheck` en
  `pnpm -r test` groen, dan pas verder. Rood laten staan is geen optie.
- Verander niets buiten de scope van de fase. Zie je onderweg iets anders dat
  stuk is, noteer het in een lijst OPEN-PUNTEN.md en ga door.
- De harde regels uit CLAUDE.md blijven gelden. In het bijzonder: geen autonome
  verzending naar externen, geen LLM-calls in MCP's, side effects alleen in
  idempotente Workflows, elke numerieke claim herleidbaar naar een tool-call,
  tenant-context op elke query.
- Nederlands in code-commentaar en UI-teksten.
- Geen em-dashes in tekst die een mens leest.
- Commentaar legt uit WAAROM iets zo is, niet WAT er staat. De bestaande
  bestanden in packages/agent-core zijn de norm, houd dat niveau vast.
- Als een wijziging een klantrepo zou breken die op dit fundament meelift,
  benoem dat expliciet in de samenvatting aan het eind.
```

---

## Fase 0: hygiëne en guardrails

**Doel:** de latente bugs dichten en een vangnet bouwen, voordat er iets
verandert. Geen nieuwe functionaliteit.

```
Lees eerst CLAUDE.md, docs/MODULES.md en docs/RECHTEN.md.

Opdracht fase 0. Werk op branch fase-0-hygiene. Geen nieuwe functionaliteit,
alleen dichten wat lek is en een vangnet bouwen.

1. Migratie: voeg een module-kolom toe (text not null default 'klantenservice')
   aan aios_tickets, aios_conversations, aios_proposed_actions,
   aios_decision_logs, aios_policy_rules, aios_memory_entries,
   aios_message_feedback, aios_unknown_intent_log, aios_partial_responses en
   aios_automations. Voeg per tabel een index toe die begint met
   (organization_id, module, ...) en die de bestaande querypatronen dekt; kijk
   daarvoor in de lib-bestanden die deze tabellen bevragen. Neem module ook op in
   de primaire sleutel van aios_ticket_counters, zodat nummerreeksen per module
   lopen. Gebruik het eerstvolgende vrije migratienummer en respecteer de
   gereserveerde ruimte uit migrations/README.md.

2. Bug: ui/app/(dashboard)/analytics/page.tsx doet geen getCurrentAccess() en
   filtert niet op module. Iedereen ziet nu de cijfers van alle modules. Zet daar
   dezelfde rechtencontrole en modulefilter op als ui/app/(dashboard)/page.tsx
   gebruikt.

3. Bug: ui/app/(dashboard)/audit/page.tsx en ui/app/api/audit/export/route.ts
   filteren kern-events niet op module, en "bekijk bron" linkt altijd naar
   /mail/{id}. Filter op de toegestane modules van de gebruiker, en laat de link
   via de module lopen (detailHref uit de registry). De export krijgt dezelfde
   controle als de pagina, niet alleen requireRole("reviewer").

4. Categorie-slugs: allCategories() en categoryLabel() in ui/lib/modules/registry.ts
   ontdubbelen nu op slug, waardoor een gedeelde slug tussen twee modules er stil
   eentje laat verdwijnen. Maak de sleutel {module, slug}. Pas de beleidseditor en
   de matching op aios_policy_rules.applies_to daarop aan, met een migratie die
   bestaande regels naar het nieuwe formaat zet.

5. scripts/check-module-guards.mjs gebruikt een handmatige lijst MODULE_ROUTES.
   Leid die lijst af uit de moduleregistry (navItems plus detailroute), zodat een
   nieuwe module niet vergeten kan worden.

6. Golden set: maak tests/golden/klantenservice.jsonl met 30 tot 50 gelabelde
   signalen (verzonnen data, example.com) met per regel het verwachte resultaat:
   in_domain, category, specialist, outcome. Schrijf een testrunner die dit met
   FakeLlmClient draait waar dat kan en die de afwijkingen als tabel rapporteert.
   Voeg hem toe aan ci.yml. Dit is het vangnet voor alle volgende fases.

Klaar als: pnpm -r typecheck en pnpm -r test groen, de golden set draait in CI,
en analytics en audit tonen alleen wat de gebruiker mag zien. Geef aan het eind
een lijst van wat een bestaande klantrepo moet doen bij het overnemen van deze
fase (welke migraties, welke handmatige stappen).
```

---

## Fase 1: het modulepakket

**Doel:** het contract neerzetten en klantenservice erin schuiven, zonder één
gedragswijziging.

```
Opdracht fase 1. Branch fase-1-modulepakket. Dit is een refactor. Het gedrag mag
niet veranderen: de golden set uit fase 0 moet exact dezelfde uitkomsten geven.

Achtergrond. Vandaag staat alle domeinkennis globaal: taxonomy/index.ts,
domain-gate/index.ts (één DOMAIN-constante), outcomes/index.ts (zes specialisten
hard gemapt) en specialists/index.ts (één bevroren CORE_INTENTS). Daardoor kan er
geen tweede domein bestaan. We maken van een module een pakket dat de kern
uitleest.

1. Maak packages/agent-core/src/modules/contract.ts met:

   export interface ModulePack {
     descriptor: ModuleDescriptor;
     claims: readonly SignalClaim[];      // { domain, type } of predicaat
     gate: DomainConfig;
     taxonomy: readonly CategoryDef[];
     specialists: readonly IntentConfig[];
     facts: readonly FactProvider[];      // fase 3 vult dit, nu leeg toegestaan
     actions: readonly ActionTypeDef[];
     outcomes: OutcomePolicy;
     review: ReviewPolicy;                // kinds, defaultKind
     memory: MemoryPolicy;                // scopes, procestags
     models?: Partial<ModelConfig>;
   }

   Ontwerp OutcomePolicy, ReviewPolicy en MemoryPolicy zo klein mogelijk: alleen
   wat de kern echt uitleest. Alles wat je nu al kunt weglaten, laat je weg.

2. Maak packages/agent-core/src/modules/registry.ts met MODULE_PACKS,
   resolveModule(signal): ModulePack | null en de lookups die de kern nodig heeft.
   resolveModule matcht op claims (domain plus type). Geen match is een expliciet
   resultaat, geen stilzwijgende terugval op klantenservice.

3. Verplaats de klantenservice-inhoud naar
   packages/agent-core/src/modules/klantenservice/: gate.ts (uit domain-gate),
   taxonomy.ts (uit taxonomy), specialists/ (de zes bestaande bestanden),
   outcomes.ts (de klantenservice-mapping uit outcomes/index.ts), pack.ts.
   De mappen taxonomy/, domain-gate/, outcomes/ en specialists/ blijven bestaan
   maar houden alleen nog het contract en de generieke hulpfuncties over.

4. Laat de lus het pakket gebruiken. In orchestrate/index.ts en in
   agents/mail-agent/src/steps.ts: haal gate, categoriegids, specialistenlijst en
   uitkomstbeleid uit de resolved ModulePack in plaats van uit de globale imports.
   Schrijf pack.descriptor.id als module op het ReviewItem.

5. De registry wordt gegenereerd, niet met de hand bijgehouden. Voeg een
   modules:-blok toe aan client.manifest.yaml en schrijf
   scripts/generate-registry.mjs die daaruit registry.generated.ts schrijft in
   zowel packages/agent-core/src/modules/ als ui/lib/modules/. Reden: registry.ts
   en agents/mail-agent/src/domain/index.ts zijn vandaag de twee bestanden die
   elke klant aanpast, en dus de bestanden waarop elke fundament-update
   semantisch botst zonder dat git een conflict meldt. Gegenereerd betekent: een
   conflict los je op door het script opnieuw te draaien.

6. Maak plek voor klantspecifieke modules: packages/agent-core/src/client-modules/
   en ui/lib/client-modules/, met een README die zegt dat het fundament die mappen
   nooit aanraakt. De generator neemt ze mee als ze in het manifest staan.

7. Werk docs/MODULES.md bij: het contract is nu het ModulePack, niet alleen de
   descriptor. Beschrijf beide helften en de generatie.

Klaar als: taxonomy/, domain-gate/, outcomes/ en specialists/ bevatten geen
klantenservice-inhoud meer, de golden set geeft identieke uitkomsten, en er is
geen enkele plek buiten de registry waar de kern een module bij naam kent.
```

---

## Fase 2: de triggerlaag

**Doel:** signalen die niet uit mail komen. Dit is de fase die de andere domeinen
mogelijk maakt.

```
Opdracht fase 2. Branch fase-2-triggers.

Achtergrond. Vandaag begint alles met een mail of een chatbericht. De Worker
heeft geen webhook-route, de cron doet alleen kickPoller, en de tabel
aios_automations bestaat met trigger, schedule en tool_scope maar wordt door geen
enkele regel code gelezen. Administratie, supply chain en sales beginnen zelden
bij een mail.

1. Envelop-model. Maak SignalEnvelope in packages/agent-core/src/contracts/:
   { subject, body, participants[], refs, attachments[], occurredAt, raw }.
   Maak een hydrator-registry per signal.domain die een Signal naar een
   SignalEnvelope brengt. agents/mail-agent/src/steps.ts regel ~736 doet nu
   `if (signal.domain !== 'mail' || !messageId) return signal` en dat wordt de
   mail-hydrator.
   Haal daarna alle directe mailvelden uit de kern: orchestrate/index.ts leest nu
   payload.from (twee plekken), payload.attachments en payload.subject. Die lezen
   voortaan uit de envelop. Na deze stap komt het woord "from" niet meer voor in
   orchestrate/index.ts.

2. Webhook-intake. Voeg POST /hooks/:source toe aan agents/mail-agent/src/index.ts:
   HMAC-verificatie met een per-bron secret (WEBHOOK_SECRET_<SOURCE>), timestamp
   tegen replay, body-limiet, en daarna aios_emit_signal met een idempotency-key
   die uit de bron komt. Een onbekende bron is 404, een verkeerde signature 401,
   en beide worden gelogd. Geen enkele verwerking in de route zelf: de route emit
   alleen.

3. Schedule-intake. Laat de cron in agents/mail-agent/src/index.ts naast
   kickPoller ook runAutomations() aanroepen: lees aios_automations van deze
   organisatie, bepaal welke schedules nu aan de beurt zijn, en emit per
   automatisering een signaal met type schedule.<naam>. Zet last_run_at en gebruik
   een idempotency-key die de tijdsleuf bevat, zodat een dubbele cron-tik geen
   dubbel signaal geeft.

4. Poll-intake. Maak een PollDefinition op het ModulePack: { source, mcp, tool,
   input, cursorField, toSignal }. Nieuwe tabel aios_poll_cursors
   (organization_id, module, source, cursor, last_run_at, last_error, pk op de
   eerste drie). De cron draait de polls van de gelicentieerde modules, diff't
   tegen de cursor en emit per nieuwe rij een signaal. Fail-soft: een MCP die niet
   antwoordt zet last_error en laat de cursor staan.

5. Uploadpad. Maak een route of Storage-hook die een geüpload document omzet naar
   een signaal document.uploaded met een verwijzing naar het bestand. De extractie
   zelf (OCR, veldherkenning) hoort in de hydrator van dat domein, niet hier.

6. Bewijs het zonder tweede module: maak een klantenservice-automatisering die
   dagelijks openstaande tickets ouder dan N dagen oppakt en een
   opvolgvoorstel maakt. Voeg hem toe aan de demo-scenario's.

Klaar als: een signaal dat niet uit mail komt loopt door de hele lus tot een
ReviewItem, de webhook-route weigert een verkeerde signature, een dubbele cron-tik
geeft geen dubbel signaal, en orchestrate/index.ts bevat geen mailveldnamen meer.
```

---

## Fase 3: de feitenlaag

```
Opdracht fase 3. Branch fase-3-feiten.

Achtergrond. IntentConfig.toolScope staat netjes op elke specialist en wordt
nergens uitgelezen. De feiten komen uit drie hardgecodeerde functies in
agents/mail-agent/src/steps.ts die tegen de demo-tabellen praten
(lookupCatalogFromDb, lookupOrderFromDb, lookupInvoiceFromDb). Daardoor werkt
grounding vandaag alleen voor demo-orders, en kan een tweede domein geen feiten
ophalen zonder een kernbestand te bewerken. Bovendien staat dataCategories wel op
de TenantContext maar wordt het in resolve niet gezet, waardoor de belofte uit
docs/RECHTEN.md niet wordt waargemaakt.

1. Maak FactProvider in packages/agent-core/src/modules/contract.ts:
   { name, mcp, tool, dataCategories, input(envelope, resolved) }. De naam is
   precies wat in toolScope van een specialist staat. input geeft null terug als
   deze bron niet van toepassing is op dit signaal.

2. Maak een feitenverzamelaar in de kern: gegeven het ModulePack en de gekozen
   specialist, verzamel de providers waarvan de naam in specialist.toolScope
   staat, roep ze aan via de bestaande callMcp, en registreer elke respons bij de
   recorder zodat er een toolCallId is. Fail-soft blijft: een MCP die niet
   antwoordt levert geen feit en laat de run doorgaan.

3. Stuur dataCategories mee op elke MCP-call, afgeleid uit de FactProvider en
   begrensd door wat de agent mag (zie docs/RECHTEN.md). Laat je ze weg, dan
   snijdt de MCP terug naar operationeel en verdwijnen velden stilzwijgend.

4. Sloop de hardgecodeerde lookups uit steps.ts en zet ze om naar FactProviders
   op het klantenservice-pakket, met de demo-tabellen als tijdelijk doel. Na deze
   stap bevat steps.ts geen SQL meer.

5. Cache feiten per run: bij een compound-mail halen meerdere specialisten nu
   dezelfde order opnieuw op. Eén cache op (tool, genormaliseerde input) binnen
   één run.

6. Test: een specialist met een lege toolScope krijgt geen feiten. Een claim
   zonder dekking valt weg. Een MCP die {ok:false} geeft leidt tot een item zonder
   cijfers, niet tot een item met verzonnen cijfers. Voeg dat laatste toe aan de
   golden set als grounding-regressietest.

Klaar als: toolScope bepaalt aantoonbaar welke feiten een specialist krijgt,
dataCategories staat op elke call, steps.ts bevat geen SQL, en de
grounding-regressietest draait in CI.
```

---

## Fase 4: de generieke werkbak

```
Opdracht fase 4. Branch fase-4-werkbak.

Achtergrond. docs/MODULES.md zegt dat een module geen React levert. Dat klopt
voor de kaart: de schil tekent de kaart uit een ReviewCardViewModel, en die regel
houden we. Voor het detailscherm houdt de regel geen stand: een offerte met
regels en een werkbon met onderdelen zijn geen viewmodel-variaties van elkaar.
We laten de regel daar expliciet los, met de reden erbij in de documentatie.

1. Voeg aan WorkbenchModule in ui/lib/modules/contract.ts toe:
   DetailView(props: { row, user }): ReactNode
   applyEdit(row, patch): Record<string, unknown>

2. Maak ui/app/(dashboard)/item/[id]/page.tsx die via moduleForRow de DetailView
   van de module ophaalt en rendert, met requireModulePage op de module van de rij.
   Laat /mail/[id] bestaan als redirect naar /item/[id], want er staan links in de
   auditlog en in verstuurde mails.

3. Verhuis de klantenservice-detailschermen: ui/components/mail-detail/* en de
   pagina-inhoud naar ui/lib/modules/klantenservice/detail/. De schil-mappen
   bevatten daarna geen mailkennis meer.

4. Maak ui/app/api/review/[id]/route.ts module-agnostisch: hij leest nu subject en
   body via mailProposed en zou een sales-item mangelen. Laat de module via
   applyEdit bepalen hoe een bewerking terug naar proposed schrijft.

5. Laat AssistantDock wisselen van module in plaats van één vaste moduleId te
   krijgen uit de layout.

6. Verhuis ook /tickets, /gesprekken en /feedback naar de klantenservicemodule,
   met requireModulePage-guards, en haal de hardcoded KLANTENSERVICE_MODULE.id uit
   de API-routes.

Klaar als: ui/components/mail-detail/ bestaat niet meer op die plek, de werkbak
gedraagt zich exact hetzelfde als voorheen, en check-module-guards is groen.
```

---

## Fase 5: module twee, administratie

**Dit is de toets op het hele ontwerp.**

```
Opdracht fase 5. Branch fase-5-administratie.

Bouw de module administratie volgens de blauwdruk in domein-administratie.md.

Harde eis, en dit is het punt van deze fase: je mag GEEN bestand aanraken buiten
deze vier plekken:
  - packages/agent-core/src/modules/administratie/
  - ui/lib/modules/administratie/
  - client.manifest.yaml plus de gegenereerde registries
  - één nieuwe migratie

Lukt dat niet, dan is het contract uit fase 1 tot 4 niet af. Stop dan, schrijf op
welk kernbestand je nodig had en waarom, en behandel dat als een gat in het
contract dat we eerst repareren. Ga niet alsnog het kernbestand bewerken.

Volgorde binnen de fase:
1. Pack met gate, taxonomie en drie specialisten. Nog geen acties.
2. FactProviders tegen de mcp-boekhouding-tools uit de blauwdruk, met demo-tabellen
   als doel zolang de MCP nog niet bestaat.
3. WorkbenchModule met toCard, DetailView en navItems.
4. Actietypen, met de bedragdrempels en goedkeurdersrollen uit de blauwdruk.
   Betaling klaarzetten, creditnota en incasso-overdracht staan op admin.
5. Triggers: de dagelijkse cron op openstaande posten en het uploadpad voor een
   inkoopfactuur.
6. Demo-scenario's uit de blauwdruk, inclusief de escalatie op een gewijzigd
   rekeningnummer.
7. Golden set voor deze module plus adversarial-gate met de eigen lijsten.

Klaar als: de module draait naast klantenservice in dezelfde werkbak, de tabs
kloppen, de rechten kloppen, en er is geen kernbestand gewijzigd.
```

---

## Fase 6 en 7: de overige modules

```
Opdracht fase 6. Branch fase-6-sales en daarna fase-6-supplychain.
Zelfde vorm en dezelfde harde eis als fase 5. Blauwdrukken:
domein-sales.md en domein-supplychain.md.
Bij supply chain: absorbeer examples/warehouse-module. Dat voorbeeld is geen
module maar een verzameling losse aanhaakpunten. Wat ontbreekt staat in de
blauwdruk: ModuleDescriptor, WorkbenchModule, registry-regel,
requireModulePage-guards op /magazijn en /onderdelen, DomainAuditSource,
actietypen en tests. Vervang het voorbeeld daarna door een verwijzing naar de
echte module, zodat er geen twee waarheden zijn.
```

```
Opdracht fase 7. Branch fase-7-marketing en fase-7-hr.
Blauwdrukken: domein-marketing.md en domein-hr.md.

Marketing vraagt eerst een uitbreiding van de RAG-laag: steps.retrieve leest nu
alleen scope PROCESS, terwijl GLOBAL (huisstijl, gepind) en CLIENT (klanthistorie)
nergens worden gelezen. Maak dat een unie over memoryScope[] van de specialist,
met GLOBAL altijd gepind. Dat is een kernwijziging en die doe je vóór de module,
in een eigen commit met eigen tests.

HR vraagt strengere rechten en een expliciete AI Act-inrichting. Lees sectie 13
van de blauwdruk voordat je begint. Er komt geen actietype voor afwijzen,
aannemen, beoordelen of ontslaan, en candidate_summary krijgt geen scoreveld.
Dat is geen preutsheid maar de reden waarom dit domein verkoopbaar is.
```

---

## Fase 8: verkoopbaar maken

```
Opdracht fase 8. Branch fase-8-verkoop.

1. Tabel aios_module_settings (organization_id, module, enabled_actions text[],
   thresholds jsonb, settings jsonb, pk op de eerste twee). De actie-poort leest
   die: een actietype dat niet in enabled_actions staat, wordt niet voorgesteld.
   Drempels uit deze tabel winnen van de code-default.

2. LICENSED_MODULES ook op de agent-Worker. Een signaal voor een module die niet
   is afgenomen gaat naar IGNORED met een reden in het beslislog, niet naar een
   stille fout.

3. Manifest als bron: het modules:-blok in client.manifest.yaml genereert de vars
   en de seed-SQL voor aios_module_settings en aios_role_grants. Eén commando dat
   een klantomgeving in de juiste stand zet.

4. scripts/new-module.sh <id> "<Label>": genereert de mappen, een lege pack, de
   UI-registratie, een migratiesjabloon en een testbestand. Zodat een nieuw domein
   invullen is, niet uitvinden.

5. Upsell in de cockpit: modules die geregistreerd zijn maar niet afgenomen,
   krijgen een uitgegrijsde tab met een korte uitleg en een knop "aanvragen" die
   een mail naar het bureau stuurt. Zichtbaar maken wat er nog kan, is de
   goedkoopste upsell die er is.

6. Demo-scenario's per module in het fundament, zodat een nieuwe klantdemo
   configuratie is en geen schrijfwerk.

7. Werk docs/NEW-CLIENT.md en DEPLOY.md bij met de moduleverhalen.
```

---

## Wat je zelf moet blijven doen

Vier dingen die niet in een opdracht passen.

**De MCP-servers.** De blauwdrukken benoemen per domein welke MCP's nieuw moeten
(boekhouding, bank, document, WMS, shipping, purchasing, CRM, pricing,
enrichment, quote, HRIS, ATS). Die zijn losse repos en een eigen bouwstroom. Het
fundament kan zonder: FactProviders die op een ontbrekende MCP uitkomen, vallen
fail-soft terug en het item gaat naar review. Begin dus met de agentkant en bouw
de MCP als een klant hem echt nodig heeft.

**De taxonomie per klant.** De blauwdrukken geven een startset. Die snoei je in
discovery met de klant. Dat is precies het gesprek dat je toch al voert, en het is
waar het maatwerk zit dat je verkoopt.

**De beslissing wat een module wordt.** Je zei: uitbreiden zodra een klantverzoek
eruitziet als iets dat vaker terugkomt. Maak dat expliciet. Een verzoek wordt een
kernmodule als je bij twee andere klanten kunt aanwijzen waar hij ook zou passen.
Kun je dat niet, dan is het een client-module en hoort hij in `client-modules/`.
Zonder die regel loopt het fundament vol met werk van één klant.

**De eval-discipline.** Fase 0 zet de golden set neer. Die is alleen iets waard
als hij bij elke module meegroeit en als een rode eval een merge tegenhoudt. Zet
dat in CI en houd je eraan, ook als het een keer ongelegen komt.

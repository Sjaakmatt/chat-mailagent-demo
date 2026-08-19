# Domeincatalogus FactumAI-fundament

Versie augustus 2026. Doel: één keuzelijst waarop gestuurd kan worden. Welke domeinen bouwen we als module op het bestaande fundament, in welke volgorde, en welke bouwen we bewust niet.

Uitgangspunt is het fundament: signaal, domain-gate, classify, resolve, retrieve, plan, grounding, ReviewItem, menselijke goedkeuring in de werkbak, uitvoeren. Er gaat nooit iets autonoom naar buiten. Het platform wordt per klant gekloond en modules worden per klant aan- of uitgezet. Een nieuw domein is daarom vooral: een gate, een taxonomie, een set specialisten, een set actietypen en de bijbehorende koppelingen. Niet een nieuw platform.

Scores zijn kwalitatief (hoog, middel, laag). Er staan bewust geen percentages of besparingscijfers in. Prioriteit 1 betekent: blauwdruk bestaat al. Prioriteit 2: eerstvolgende bouw. Prioriteit 3: pas bij aantoonbare vraag of als betaalde uitbreiding op een bestaande module. Prioriteit 4: niet bouwen zonder een concrete, betalende aanleiding.

---

## Deel A. De volledige domeincatalogus

| Domein | Module-id | Voorkomen MKB 20-100 FTE | Betalingsbereidheid | Bouwkosten op fundament | Herbruikbaarheid | Type | Prio |
|---|---|---|---|---|---|---|---|
| Klantenservice (blauwdruk bestaat) | `klantenservice` | hoog | middel: pijn is zichtbaar, maar er is veel goedkope helpdesksoftware die "goed genoeg" lijkt | laag | hoog | commodity | 1 |
| Sales (blauwdruk bestaat) | `sales` | hoog | middel: iedereen wil meer omzet, weinigen betalen voor opvolging | laag | hoog | commodity | 1 |
| Administratie en finance (blauwdruk bestaat) | `finance` | hoog | hoog: directe link met geld binnenhalen en fouten voorkomen | laag | hoog | commodity, met differentiatie in de koppelingen | 1 |
| Supply chain en operations (blauwdruk bestaat) | `operations` | middel | hoog: raakt de primaire kosten | laag | middel | differentiator | 1 |
| Marketing (blauwdruk bestaat) | `marketing` | hoog | laag: budget gaat naar bureaus en advertenties, niet naar procesautomatisering | laag | middel | commodity | 1 |
| HR en recruitment (blauwdruk bestaat) | `hr` | middel | middel: pijn is echt, maar er zijn veel losse tools | laag | hoog | commodity | 1 |
| Bouw en installatie, inclusief WKB | `bouw-installatie` | middel algemeen, hoog in de eigen regio en het bestaande netwerk | hoog: WKB is een wettelijke verplichting met aansprakelijkheid eronder | middel | middel: kern is herbruikbaar, borgingsplannen verschillen per kwaliteitsborger | differentiator | 2 |
| Compliance en contract | `compliance-contract` | hoog: elk bedrijf met personeel en klantdata heeft dit | middel tot hoog: geen omzet, wel risico en boetes | middel | hoog: wetgeving is voor iedereen gelijk | differentiator | 2 |
| Directie en rapportage | `directie-rapportage` | hoog | middel: directie betaalt voor overzicht, maar niet apart als het al bij een andere module zit | laag: leest de eigen platformlogs, geen externe koppelingen | hoog | differentiator | 2 |
| Interne servicedesk (IT en facilitair) | `interne-servicedesk` | middel: relevant vanaf ongeveer 50 FTE | laag tot middel: interne tijd wordt zelden hard afgerekend | laag: variant op `klantenservice` | hoog | commodity | 2 |
| Projectadministratie en urenregistratie | `projecten-uren` | hoog bij projectgedreven bedrijven | hoog: niet geschreven uren en niet gefactureerd meerwerk zijn direct verlies | middel | hoog | differentiator in de naad tussen systemen | 2 |
| E-commerce operatie (retouren, reviews, productdata) | `ecommerce-operatie` | middel | middel | laag tot middel | hoog binnen de niche | commodity | 3, als uitbreidingspakket op `klantenservice` en `operations`, geen eigen module |
| Kwaliteit en klachten (ISO, NCR) | `kwaliteit-klachten` | middel | middel: audits zijn een deadline, dus er is een moment om te kopen | laag | middel | differentiator | 3 |
| Inkoop | `inkoop` | middel | middel | laag | middel | commodity, hoort als submodule onder `operations` | 3 |
| Service en onderhoud (installatie- en servicebedrijven) | `service-onderhoud` | middel | hoog: contractomzet en storingen zijn direct geld | middel | middel | differentiator, sterk overlappend met `bouw-installatie` | 3 |
| Aanbestedingen en tenderdesk | `tender-desk` | laag tot middel | hoog: één gewonnen tender betaalt alles terug | middel | middel | differentiator | 3 |
| Accountants- en administratiekantoren | `accountancy-kantoor` | middel binnen die branche | hoog | middel | middel: kantoren verschillen sterk in werkwijze en software | differentiator, verticale variant op `finance` | 3 |
| Interne kennisbank en documentzoek | `kennisbank` | hoog | laag als losse dienst: te veel gratis alternatieven | laag | hoog | ondersteunende capability, geen zelfstandig domein | 3 |
| Planning en werkvoorbereiding | `planning-werkvoorbereiding` | middel | hoog | hoog: echte planningsoptimalisatie is een ander soort probleem dan een agentketen | laag: iedere planner plant anders | differentiator, maar duur | 4 |
| Transport en ritplanning | `transport-planning` | middel binnen logistiek | middel | hoog: TMS-pakketten doen dit al goed | laag | commodity | 4 |
| Groothandel | (geen eigen id) | middel | middel | n.v.t. | n.v.t. | valt uiteen in `operations`, `finance` en `ecommerce-operatie` | 4 |
| Vastgoed en beheer | `vastgoed-beheer` | laag | middel | middel | laag: sterk afhankelijk van het beheerpakket | commodity | 4 |
| Zorgadministratie | `zorg-administratie` | laag tot middel | middel | hoog: NEN 7510, medische gegevens, extra verwerkersrisico | laag | differentiator, maar zwaar | 4 |
| Onderwijsadministratie | `onderwijs-administratie` | laag | laag: aanbestedingsplicht en trage besluitvorming | hoog | laag | niet passend | 4 |
| Horeca-operatie | `horeca-operatie` | laag qua kantoorproces | laag | middel | laag | niet passend | 4 |
| Retail-filiaalbeheer | `retail-filiaal` | laag tot middel | laag | middel | laag | commodity | 4 |
| Klantonboarding en WWFT/KYC | `wwft-onboarding` | laag, alleen gereguleerde dienstverleners | hoog | hoog: toezichthouderrisico | laag | differentiator, maar te smal | 4 |
| Wagenpark- en materieelbeheer | `wagenpark` | middel | laag | middel | laag | commodity | 4 |
| Subsidies en fiscale regelingen (WBSO en dergelijke) | `subsidies` | laag | middel | middel | laag | geen herhaalbaar volume | 4 |

Juridisch en contractbeheer staat niet als aparte regel. Contractbewaking, verloopdatums en verwerkersafspraken zitten in `compliance-contract`. Juridisch advies zelf bouwen we niet, dat is geen procesautomatisering maar aansprakelijkheid.

---

## Deel B. Korte blauwdrukken per prioriteit-2-domein

### B1. Bouw en installatie (`bouw-installatie`)

**Waarom dit domein.** De WKB is een wettelijke verplichting met aansprakelijkheid eronder, dus er is een koper en een deadline. Het dossierwerk is administratief, herhaalbaar en wordt nu met mail, mappen en Excel gedaan. FactumAI heeft al werk in kraanverhuur en installatie, dus er is domeinkennis in huis.

**Triggers en signaalbronnen**

| signal.type | Bron | Frequentie |
|---|---|---|
| `email.inbound` | projectmailbox, onderaannemers, opdrachtgever | hoog |
| `form.submit` | locatie-inspectie, opleverformulier uit de veldapp | middel |
| `doc.upload` | keuringsrapport, tekening, certificaat, werkbon | middel |
| `erp.event` | projectstatuswijziging uit het projectsysteem | middel |
| `schedule.tick` | dagelijkse scan op verlopende keuringen en incomplete dossiers | dagelijks |

**Domain-gate.** Het gaat over de uitvoering van een project: dossieropbouw en bewijsstukken, werkvoorbereiding, meer- en minderwerk, onderaannemers, keuringen en certificaten, oplevering en gereedmelding. Het gaat niet over de commerciële offerte richting een nieuwe opdrachtgever (`sales`), niet over facturatie en debiteuren (`finance`), niet over personeelsroosters (`hr`) en niet over algemene klantvragen zonder projectnummer (`klantenservice`). Zonder herleidbaar project- of werkordernummer valt een signaal buiten de gate en gaat het terug naar triage.

**Taxonomie**
- `wkb-dossier`: bewijsstuk, borgingsplan of dossierstatus
- `werkvoorbereiding`: informatie die de uitvoering nodig heeft voor start
- `meer-minderwerk`: scopewijziging met financiële gevolgen
- `onderaannemer`: coördinatie, planning, aanlevering
- `keuring-certificaat`: keuring, inspectie, geldigheid
- `oplevering`: opleverpunten, restpunten, gereedmelding
- `veiligheid-incident`: onveilige situatie, incident, VCA
- `projectwijziging-klant`: wijzigingsverzoek vanuit de opdrachtgever
- `levering-materiaal`: materiaal, levertijd, afroep

**Specialisten**

| id | Wat het doet | modelTierHint | needsHitl |
|---|---|---|---|
| `dossier-compleetheid` | vergelijkt aanwezige bewijsstukken met het borgingsplan en benoemt gaten | `standard` | nee |
| `meerwerk-detector` | herkent scopewijziging in mail of werkbon en schat het gevolg | `heavy` | ja |
| `keuringstermijn-bewaker` | signaleert verlopende of ontbrekende keuringen en certificaten | `light` | nee |
| `onderaannemer-opvolger` | stelt de opvolgmail op bij ontbrekende aanlevering | `standard` | ja |
| `opleverpunt-extractor` | haalt restpunten uit inspectieformulieren en foto's | `standard` | ja |

**ReviewItem-kinds.** `dossier_gap_report`, `meerwerk_proposal`, `subcontractor_message`, `inspection_task`, `handover_checklist`.

**Actietypen**

| type-slug | Doelsysteem | Wat de mens moet zien |
|---|---|---|
| `wkb.dossier.status.update` | projectsysteem of documentopslag | welke stukken ontbreken, wat de statuswijziging betekent, wie verantwoordelijk is |
| `subcontractor.email.send` | Outlook of M365 | volledige conceptmail, ontvanger, het openstaande punt en de bron ervan |
| `meerwerk.voorstel.create` | PDF-renderer plus projectsysteem | onderbouwing, de mailregel of werkbon waaruit het volgt, en dat de prijs door een mens wordt bepaald |
| `inspection.ticket.create` | projectsysteem of ticketsysteem | welke keuring, welke termijn, welk object |
| `oplevering.plan` | agenda | datum, aanwezigen, openstaande restpunten |

**MCP's en systemen.** Outlook en M365, documentopslag (SharePoint of vergelijkbaar), projectsysteem (bijvoorbeeld Odoo of een bouwpakket), veldformulieren of inspectie-app, agenda, PDF-renderer.

**Grootste risico of grens.** Het WKB-dossier is juridisch bewijs. De agent stelt samen en signaleert, maar doet nooit zelf een gereed- of bouwmelding en verklaart nooit dat een dossier compleet is. Tweede risico: borgingsplannen en controlepunten verschillen per kwaliteitsborger, dus per klant is er configuratiewerk. Reken dat in, verkoop het niet als plug-and-play.

---

### B2. Compliance en contract (`compliance-contract`)

**Waarom dit domein.** Elke klant met personeel en klantdata heeft AVG-verplichtingen en contracten met verloopdatums, en bijna niemand heeft dat proces ingericht. De wetgeving is voor iedereen gelijk, dus wat we één keer bouwen werkt bij elke klant. Het sluit aan op wat FactumAI voor zichzelf al af heeft, dus we verkopen iets dat we zelf gebruiken.

**Triggers en signaalbronnen**

| signal.type | Bron | Frequentie |
|---|---|---|
| `email.inbound` | privacy- of info-mailbox | laag tot middel |
| `form.submit` | AVG-verzoekformulier op de website | laag |
| `doc.upload` | nieuw contract, DPA, leveranciersvoorwaarden | middel |
| `schedule.tick` | dagelijkse scan op verlooptermijnen, opzegtermijnen en bewaartermijnen | dagelijks |
| `system.event` | nieuwe leverancier of sub-processor toegevoegd | laag |

**Domain-gate.** Het gaat over rechten van betrokkenen (inzage, rectificatie, verwijdering, bezwaar), identiteitsverificatie bij die verzoeken, datascope-mapping, consent, verwerkersafspraken, contractbewaking en verloopdatums, en de AI Act-classificatie van agents. Het gaat niet over juridische geschillen, arbeidsrechtelijke kwesties, fiscale compliance (`finance`) of inhoudelijke klachtafhandeling over een product (`kwaliteit-klachten`). De agent geeft geen juridisch advies. Hij bereidt voor en bewaakt termijnen.

**Taxonomie**
- `dsar-inzage`: verzoek om inzage of export
- `dsar-verwijdering`: verzoek om vergetelheid
- `dsar-rectificatie`: correctieverzoek
- `bezwaar-beslissing`: bezwaar tegen een geautomatiseerde beslissing
- `contract-verloop`: naderende einddatum of opzegtermijn
- `contract-intake`: nieuw contract dat vastgelegd moet worden
- `verwerkers-dpa`: ontbrekende of verouderde verwerkersovereenkomst
- `consent-audit`: toestemming ontbreekt of is verlopen
- `incident-datalek`: mogelijk datalek of beveiligingsincident
- `ai-act-classificatie`: nieuwe of gewijzigde agent moet geclassificeerd worden

**Specialisten**

| id | Wat het doet | modelTierHint | needsHitl |
|---|---|---|---|
| `verzoek-classificatie` | bepaalt of het een AVG-verzoek is en welk artikel het raakt | `standard` | nee |
| `identiteit-check` | bereidt de identiteitsverificatie voor en benoemt wat ontbreekt | `standard` | ja |
| `datascope-mapper` | zoekt op waar de persoonsgegevens van deze betrokkene staan | `heavy` | ja |
| `termijnbewaker` | signaleert wettelijke en contractuele termijnen | `light` | nee |
| `responsbrief-opsteller` | stelt de formele responsbrief op met bronverwijzing | `heavy` | ja |

**ReviewItem-kinds.** `dsar_response_draft`, `identity_check_request`, `data_export_bundle`, `contract_renewal_notice`, `dpa_gap_report`, `breach_assessment`.

**Actietypen**

| type-slug | Doelsysteem | Wat de mens moet zien |
|---|---|---|
| `dsar.response.send` | mail plus PDF-renderer | de volledige brief, het wettelijke artikel, de resterende termijn |
| `data.export.generate` | database en opslag | welke bronnen zijn doorzocht, wat wel en niet is meegenomen |
| `contract.reminder.send` | mail en agenda | contract, einddatum, opzegtermijn, gevolg van niets doen |
| `dpa.request.send` | mail | welke leverancier, waarom er een DPA ontbreekt |
| `compliance.log.entry` | verwerkingsregister | wat wordt vastgelegd en waarom |

**MCP's en systemen.** Mailbox, documentopslag, de klantdatabase zelf (voor datascope en export), contractenregister of CRM, agenda, PDF-renderer.

**Grootste risico of grens.** Termijnen zijn wettelijk. Een gemiste maand is een echt probleem, dus escalatie bij naderende termijn is hard ingebouwd, niet optioneel. De agent verwijdert nooit zelf data en stelt nooit zelf een identiteit vast. Beide zijn menselijke beslissingen met een gelogde goedkeuring. En we verkopen dit als governance-hygiëne, niet als deadlinepaniek.

---

### B3. Directie en rapportage (`directie-rapportage`)

**Waarom dit domein.** Dit is de enige module die waarde toevoegt bóven de andere modules in plaats van ernaast. Hij maakt zichtbaar wat het platform doet, wat het oplevert en waar het vastloopt, en dat is precies wat een directeur nodig heeft om de retainer te blijven betalen. Bouwkosten zijn laag omdat er geen nieuwe externe koppelingen bij komen.

**Architectuur, dit is het verschil.** Alle andere modules lezen externe systemen. Deze leest het platform zelf: de beslislogs, de ReviewItems, de goedkeuringen en afkeuringen, de doorlooptijden en de actie-uitvoeringen van elke actieve module binnen dezelfde tenant. Er is dus een interne, alleen-lezen bron in plaats van een MCP naar buiten. Dat heeft drie gevolgen. Ten eerste is grounding eenvoudig af te dwingen: elk cijfer in een digest moet herleidbaar zijn naar een logregel binnen dezelfde tenant, anders wordt het weggelaten. Ten tweede is autorisatie een ontwerpvraag: de directiemodule ziet geaggregeerde cijfers en mag niet ongefilterd persoonsgegevens uit de HR-module of DSAR-inhoud uit de compliance-module tonen. Ten derde schaalt de module vanzelf mee: elke module die je aanzet, levert automatisch signaal aan de digest zonder extra bouwwerk.

**Triggers en signaalbronnen**

| signal.type | Bron | Frequentie |
|---|---|---|
| `schedule.tick` | vaste weekdigest en maanddigest | wekelijks en maandelijks |
| `platform.metric.threshold` | oplopende reviewwachtrij, stijgend afkeurpercentage, doorlooptijd buiten bandbreedte | continu |
| `module.escalation` | escalatie die in een andere module niet is opgepakt | ad hoc |
| `calendar.event` | geplande MT- of bestuursvergadering | maandelijks |
| `web.watch` | optionele monitoring van een vaste lijst concurrenten of marktbronnen | wekelijks |

**Domain-gate.** Het gaat over samenvatten, signaleren en agenderen op basis van wat het platform al weet. Het gaat niet over individuele cases: een enkele klantmail, factuur of sollicitatie hoort in de module waar hij vandaan komt. De directiemodule voert geen enkele actie uit in een klantsysteem. Zijn enige uitvoer is een document, een mail naar de directie of een signaal in de eigen werkbak.

**Taxonomie**
- `week-digest`: vaste periodieke samenvatting
- `mt-voorbereiding`: pakket voor een vergadering
- `risico-signaal`: iets dreigt mis te gaan
- `doorlooptijd-afwijking`: proces duurt structureel langer
- `agentkwaliteit`: afkeurpercentage of correcties lopen op
- `capaciteitssignaal`: werkbak groeit sneller dan hij wordt leeggewerkt
- `kans-signaal`: patroon dat op omzet of besparing wijst
- `markt-concurrentie`: externe ontwikkeling uit de watchlist

**Specialisten**

| id | Wat het doet | modelTierHint | needsHitl |
|---|---|---|---|
| `log-aggregator` | verzamelt en telt gebeurtenissen per module en periode | `light` | nee |
| `afwijkingsdetector` | vergelijkt met de vorige periode en markeert wat afwijkt | `standard` | nee |
| `narratief-opsteller` | schrijft de digest in gewone taal | `heavy` | ja |
| `grounding-checker` | verwerpt elke bewering zonder logregel eronder | `standard` | nee |

**ReviewItem-kinds.** `digest_draft`, `risk_flag`, `board_pack`, `quality_alert`.

**Actietypen**

| type-slug | Doelsysteem | Wat de mens moet zien |
|---|---|---|
| `digest.publish` | mail plus PDF-renderer | de volledige tekst met per cijfer de bron |
| `risk.flag.create` | eigen werkbak | het signaal, de onderliggende gebeurtenissen, de voorgestelde eigenaar |
| `board.pack.generate` | PDF-renderer | het hele document, inclusief wat bewust is weggelaten |
| `metric.annotation.add` | eigen platform | welke duiding bij welk cijfer wordt vastgelegd |

**MCP's en systemen.** Vrijwel geen externe: interne read-only toegang tot logs en ReviewItems, mail, agenda, PDF-renderer, optioneel een webwatcher.

**Grootste risico of grens.** Deze module verleidt tot verzinnen. Een digest leest prettig met een percentage erin, en juist daar hoort de harde grounding-regel. Geen logregel is geen bewering. Tweede grens: dit is geen BI-tool en concurreert niet met Power BI of Qlik. Wie hem als dashboardvervanger verkoopt, verliest.

---

### B4. Interne servicedesk (`interne-servicedesk`)

**Waarom dit domein.** Vanaf ongeveer 50 FTE ontstaat een interne stroom meldingen over accounts, laptops, licenties en het pand, meestal in een gedeelde mailbox of Teams-kanaal. Het proces lijkt sterk op klantenservice. Er is dus veel waarde tegen weinig bouwwerk, mits we het niet als nieuwe module opzetten.

**Bouw dit als variant, niet als nieuwe module.** De keten is identiek aan `klantenservice`: intake, classificatie, context ophalen, beleid toetsen, antwoord of ticket voorstellen, mens keurt goed. Wat verschilt is niet de keten maar de configuratie. De gate kijkt of de afzender in de eigen medewerkersdirectory staat in plaats van in het klantenbestand. De kennisbank is de interne, niet de klantgerichte. De rechten zijn ruimer richting interne systemen en strakker richting buiten: er gaat per definitie niets naar een externe partij. De taxonomie en de SLA-regels zijn anders. Dat is een profiel bovenop dezelfde module-code, met een eigen domain-gate en eigen retrieval-bronnen. Twee losse codebases voor hetzelfde proces betekent dubbel onderhoud en dubbele regressietesten, en dat is precies de kostenpost die het fundament moest wegnemen. Enige reden om het toch te splitsen zou zijn dat de autorisatielogica rond toegangsverzoeken zo zwaar wordt dat hij de klantenservicemodule vervuilt. Dat is nu niet zo, want de agent kent geen rechten toe.

**Triggers en signaalbronnen**

| signal.type | Bron | Frequentie |
|---|---|---|
| `email.inbound` | interne ict- of facilitaire mailbox | middel |
| `chat.message` | Teams-kanaal of helpdeskbot | middel |
| `form.submit` | intern meldingsformulier | middel |
| `hr.event` | in- of uitdiensttreding uit de HR-module | laag |
| `schedule.tick` | scan op meldingen die langer openstaan dan de SLA | dagelijks |

**Domain-gate.** Alleen meldingen van eigen medewerkers over eigen middelen: accounts en toegang, hardware, software en licenties, netwerk, en het gebouw. Niet: klantvragen (die vallen terug naar `klantenservice`), niet salaris- of contractvragen (`hr`), niet inkoopbeslissingen boven een drempel (`finance` of `inkoop`). Externe afzender betekent per definitie buiten de gate.

**Taxonomie**
- `toegang-account`: wachtwoord, account, rechten
- `hardware-storing`: laptop, telefoon, randapparatuur
- `software-vraag`: hoe werkt iets
- `licentie-aanvraag`: nieuwe of extra licentie
- `netwerk-storing`: verbinding, wifi, VPN
- `facilitair-melding`: pand, verwarming, sleutels, schoonmaak
- `onboarding-offboarding`: nieuwe of vertrekkende medewerker
- `informatieverzoek`: verwijzing naar beleid of document

**Specialisten**

| id | Wat het doet | modelTierHint | needsHitl |
|---|---|---|---|
| `interne-identificatie` | koppelt afzender aan medewerker, afdeling en middelen | `light` | nee |
| `kennisbank-antwoord` | stelt het antwoord op uit interne documentatie | `standard` | ja |
| `toegangsbeoordelaar` | toetst een toegangsverzoek aan het rollenbeleid en benoemt de goedkeurder | `standard` | ja |
| `prioriteitsbepaler` | bepaalt urgentie en SLA-klasse | `light` | nee |
| `onboarding-orchestrator` | maakt de checklist voor een nieuwe medewerker | `standard` | ja |

**ReviewItem-kinds.** `internal_reply_draft`, `access_request_review`, `ticket_proposal`, `onboarding_checklist`.

**Actietypen**

| type-slug | Doelsysteem | Wat de mens moet zien |
|---|---|---|
| `ticket.create` | Topdesk, Jira Service Management, Freshservice of vergelijkbaar | categorie, prioriteit, melder, samenvatting |
| `internal.reply.send` | mail of Teams | het volledige concept en de bron uit de kennisbank |
| `access.request.route` | ticketsysteem, nooit de identity provider | wie moet goedkeuren, welke rechten, waarom |
| `facility.workorder.create` | facilitair systeem | locatie, melding, urgentie |
| `ticket.status.update` | ticketsysteem | oude en nieuwe status met reden |

**MCP's en systemen.** Mail en Teams, ticketsysteem, interne kennisbank of documentopslag, HR-bron voor de medewerkersdirectory, agenda. Bewust géén schrijfrechten op de identity provider.

**Grootste risico of grens.** Rechten. De agent stelt toegang voor en routeert, maar kent nooit zelf autorisaties toe. Dat is een privilege-escalatiepad en dus een principiële grens. Commercieel geldt: interne tijd wordt zelden hard afgerekend, dus verkoop dit als uitbreiding op een lopende klant en niet als losstaande eerste deal.

---

### B5. Projectadministratie en urenregistratie (`projecten-uren`)

**Waarom dit domein.** Bij elk projectgedreven bedrijf, van engineering tot bureau tot installatie, lekt marge weg via niet geschreven uren, te laat gesignaleerde budgetoverschrijding en meerwerk dat nooit gefactureerd wordt. Dat is direct geld, dus de betalingsbereidheid is hoog. Het proces zit in de naad tussen urenregistratie, projectsysteem en boekhouding, en juist daar zit geen bestaand pakket.

**Triggers en signaalbronnen**

| signal.type | Bron | Frequentie |
|---|---|---|
| `schedule.tick` | scan op ontbrekende uren en budgetverbruik | dagelijks en wekelijks |
| `erp.event` | boeking, projectmutatie of budgetwijziging | dagelijks |
| `email.inbound` | klantmail met een wijziging of extra verzoek | middel |
| `calendar.event` | agenda-afspraken die niet terugkomen in geschreven uren | dagelijks |
| `doc.upload` | werkbon, bon, urenbriefje | middel |

**Domain-gate.** Het gaat over de administratieve kant van projecten: urenregistratie en volledigheid, projectbudget en verbruik, factureerbaarheid, nacalculatie, scopewijzigingen met financiële gevolgen en projectrapportage. Het gaat niet over salarisverwerking of verlof (`hr`), niet over debiteurenbeheer en aanmaningen (`finance`), niet over wie wanneer waar staat ingepland (`operations`) en niet over de technische inhoud van het project. Een signaal zonder projectcode gaat terug naar triage.

**Taxonomie**
- `uren-ontbrekend`: medewerker heeft niet of te laat geschreven
- `uren-verkeerd-geboekt`: uren op het verkeerde project of de verkeerde soort
- `budget-overschrijding`: verbruik loopt uit de pas met de begroting
- `scope-wijziging`: klant vraagt iets buiten de opdracht
- `factureerbaar-niet-gefactureerd`: gereed werk zonder factuurregel
- `nacalculatie-afwijking`: verschil tussen begroot en werkelijk
- `projectstatus-rapport`: periodieke rapportage richting klant of directie
- `tarief-afwijking`: geboekt tarief wijkt af van de afspraak

**Specialisten**

| id | Wat het doet | modelTierHint | needsHitl |
|---|---|---|---|
| `urenreconciliatie` | vergelijkt agenda, werkbonnen en geboekte uren en benoemt gaten | `light` | nee |
| `budgetbewaker` | signaleert overschrijding en projecteert het restbudget | `standard` | nee |
| `scopedetector` | herkent in klantcorrespondentie een verzoek buiten de opdracht | `heavy` | ja |
| `factuurvoorstel-opsteller` | bundelt factureerbaar werk tot een conceptregel | `standard` | ja |
| `nacalculatie-analist` | duidt het verschil tussen begroot en werkelijk | `standard` | ja |

**ReviewItem-kinds.** `timesheet_gap_report`, `budget_alert`, `scope_change_draft`, `invoice_proposal`, `project_report_draft`.

**Actietypen**

| type-slug | Doelsysteem | Wat de mens moet zien |
|---|---|---|
| `timesheet.reminder.send` | mail of chat | wie, welke dagen, welk project, en de bron van de constatering |
| `project.flag.create` | projectsysteem | het signaal, de cijfers eronder en de projectleider die het oppakt |
| `invoice.proposal.create` | overdracht naar de finance-module | welke regels, welk tarief, welke onderbouwing per regel |
| `scope.change.draft` | PDF-renderer en projectsysteem | de mailregel waaruit de wijziging blijkt en het voorgestelde gevolg |
| `project.status.report` | mail plus PDF-renderer | het hele rapport met bron per cijfer |

**MCP's en systemen.** Urenregistratie of ERP (bijvoorbeeld Odoo, Exact, Simplicate, AFAS), projectsysteem, agenda, mailbox, PDF-renderer, en een interne koppeling naar de finance-module.

**Grootste risico of grens.** Datakwaliteit. Als uren slordig geboekt worden, is elke conclusie van de agent slordig, en dat merk je pas als de klant een verkeerde factuur ziet. Dus: eerst een periode alleen signaleren en rapporteren, pas daarna factuurvoorstellen. Harde grens: de agent boekt nooit uren op naam van een medewerker en verstuurt nooit zelf een factuur.

---

## Deel C. De eerlijke afvallers

Domeinen die we bewust niet als module bouwen, met de reden in één regel.

- **Planning en werkvoorbereiding als optimalisatieprobleem.** Echte planning is combinatorische optimalisatie, geen agentketen, en iedere planner plant anders. Ondersteunende signalering kan wel, onder `operations`.
- **Transport en ritplanning.** Bestaande TMS-pakketten doen dit beter en goedkoper dan wij het kunnen bouwen.
- **Onderwijsadministratie.** Trage besluitvorming, aanbestedingsdruk en lage betalingsbereidheid bij hoge bouwkosten.
- **Horeca-operatie.** Weinig herhaalbaar kantoorproces met volume en een dun budget voor maatwerk.
- **Retail-filiaalbeheer.** Wat herhaalbaar is zit al in kassa- en voorraadsoftware, de rest is per keten anders.
- **Zorgadministratie.** NEN 7510, medische gegevens en ketenregels maken de compliance-last onevenredig zwaar voor de omvang van het bureau. Alleen doen bij een concrete klant met budget en een duidelijke afbakening.
- **WWFT- en KYC-onboarding.** Toezichthouderrisico bij een smalle doelgroep. Niet als standaardmodule.
- **Wagenparkbeheer.** Lage betalingsbereidheid en bestaande leasetooling.
- **Subsidie- en regelingenbegeleiding.** Geen herhaalbaar volume, dit is adviseurswerk en geen procesautomatisering.
- **Groothandel als domein.** Bestaat niet als domein. Het valt uiteen in `operations`, `finance` en `ecommerce-operatie`. Verkoop de branche, bouw de modules.
- **Kennisbank als losse dienst.** Prima als capability binnen andere modules, kansloos als losse propositie naast de gratis alternatieven.
- **Juridisch advies.** Geen automatiseringsvraag maar een aansprakelijkheidsvraag. Contractbewaking wel, oordelen niet.
- **Vastgoed en beheer.** Sterk afhankelijk van het beheerpakket van de klant, dus lage herbruikbaarheid bij middelhoge bouwkosten.

---

## Wat dit betekent voor de volgorde

De zes bestaande blauwdrukken blijven de commerciële basis. Daarna bouwen we in deze volgorde: `directie-rapportage` eerst, omdat hij de laagste bouwkosten heeft en de waarde van alle andere modules zichtbaar maakt. Dan `compliance-contract`, omdat het bij elke klant hetzelfde is en een differentiator is die we zelf al draaien. Dan `bouw-installatie`, omdat er domeinkennis en een klant is, met de aantekening dat er configuratiewerk per klant in zit. Dan `projecten-uren`, omdat de betalingsbereidheid daar het hoogst is. `interne-servicedesk` bouwen we als profiel op de bestaande klantenservicemodule en verkopen we als uitbreiding, niet als eerste deal.

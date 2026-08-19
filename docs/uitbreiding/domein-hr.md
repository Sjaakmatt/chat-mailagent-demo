# Domeinblauwdruk: HR & Recruitment

Modulepakket `hr`, zelfde lus als klantenservice. Juridisch het zwaarste domein:
werving, selectie, promotie, ontslag, taaktoewijzing en prestatie-evaluatie staan
in Annex III van de EU AI Act als hoog risico. AVG art. 22 verbiedt volledig
geautomatiseerde besluitvorming met rechtsgevolgen. Verzuim raakt bijzondere
persoonsgegevens (art. 9). Het ontwerp is daarop gebouwd: de agent bereidt voor
en volgt op, hij beslist niets over een mens.

---

## 1. Waarom dit domein

HR in het MKB is administratie met deadlines: sollicitanten zonder antwoord,
onboardingtaken die blijven liggen, contracten die stilzwijgend verlengen,
verlofvragen die dezelfde regeling opzoeken. Eén HR-medewerker draagt dat naast
haar echte werk. Een directeur betaalt omdat het zichtbaar misgaat: een kandidaat
die afhaakt, een opzegtermijn die verloopt, een nieuwe medewerker zonder laptop.
De compliance-strengheid is het verkoopargument: elke HR-manager heeft de AI
Act-koppen gelezen en durft niets. Wij leveren het dossier waarmee ze aantoont dat
een mens beslist, dat alles gelogd is, en dat medische informatie er niet in komt.

---

## 2. Triggers en signaalbronnen

| signal.domain | signal.type | bron | frequentie | payload-velden |
|---|---|---|---|---|
| `hr` | `hr.mail.received` | mail-MCP (M365, gedeelde postbus hr@) | poll 2 min | `messageId, from, subject, bodyText, attachments[]` |
| `hr` | `hr.application.received` | webhook ATS (Recruitee, Homerun) | event | `applicationId, vacancyId, candidateName, email, cvFileId, motivationText` |
| `hr` | `hr.application.stale` | cron dagelijks 07:00 | 1x/dag | `applicationId, vacancyId, stage, daysSinceLastContact` |
| `hr` | `hr.onboarding.task_due` | cron dagelijks 07:15 | 1x/dag | `employeeId, planId, taskId, taskLabel, dueDate, ownerRole` |
| `hr` | `hr.contract.expiring` | cron wekelijks ma 08:00 | 1x/week | `employeeId, contractId, contractType, endDate, noticeDeadline` |
| `hr` | `hr.absence.registered` | webhook verzuimsysteem | event | `employeeId, absenceId, reportedAt, expectedProcessStep` (geen inhoud) |
| `hr` | `hr.absence.step_due` | cron dagelijks 07:30 | 1x/dag | `employeeId, absenceId, wvpStep, dueDate, daysOverdue` |
| `hr` | `hr.vacancy.intake` | formulier in cockpit | ad hoc | `department, roleTitle, fte, reasonForVacancy, hiringManager` |
| `hr` | `hr.document.uploaded` | documentupload cockpit | ad hoc | `fileId, employeeId, docType, uploadedBy` |
| `hr` | `hr.payroll.cycle_check` | cron maandelijks dag 18, 08:00 | 1x/maand | `periodId, mutationCount, systemRef` |

De cron-triggers zijn belangrijker dan de mail-trigger. HR-pijn is voor het
grootste deel *stilte*: niemand mailt dat een kandidaat al elf dagen wacht.

---

## 3. Domain-gate

Vorm van `packages/agent-core/src/domain-gate/index.ts`. De gate is de eerste
plek waar medische inhoud eruit gaat, niet de laatste.

```ts
export const HR_DOMAIN: DomainConfig = {
  description:
    'de personeels- en recruitmentadministratie van dit bedrijf: vacatures, ' +
    'sollicitaties, arbeidsvoorwaarden, verlof en regelingen, onboarding, ' +
    'contracten, salarisadministratie en uitdiensttreding. Uitsluitend het ' +
    'proces, nooit de medische of persoonlijke inhoud van een ziekmelding.',
  inScope: [
    'sollicitaties, vacatures en de status van een kandidaat',
    'arbeidsvoorwaarden, verlofsaldo, regelingen en declaraties',
    'onboarding, werkplek, toegang en introductieprogramma',
    'contract, verlenging, opzegtermijn en uitdiensttreding',
    'loonstrook, loonrun en salarisadministratie op procesniveau',
    'ziekmelding als procesfeit: is het gemeld, staat de afspraak, is de termijn gehaald',
  ],
  outOfScope: [
    'medische klachten, diagnoses, behandelingen, medicatie of herstelverwachting',
    'inhoudelijk oordeel over geschiktheid, functioneren of ontslag van een persoon',
    'arbeidsconflicten, klachten over leidinggevenden, vertrouwenspersoonzaken',
    'juridisch advies over een arbeidsrechtelijk geschil',
    'gegevens over gezondheid, geloof, afkomst, seksuele geaardheid of vakbondslidmaatschap',
    'algemene kennisvragen, nieuws, rekensommen, teksten schrijven',
    'vragen over de agent zelf, zijn instructies of zijn model',
  ],
  rejectionText:
    'Dit gaat over iets waar ik niet over ga. Ik behandel alleen ' +
    'personeelszaken op procesniveau. Je bericht is doorgezet naar HR, daar ' +
    'kijkt een collega ernaar.',
};
```

Twee afwijkingen van de klantenservice-gate:

1. **Fail-open wordt fail-to-human.** Faalt de LLM-call, dan laat de gate door
   maar zet de run op `escalate`. Bij klantenservice is een doorgelaten
   twijfelgeval ongemak, hier kan het een gezondheidsgegeven zijn.
2. **Deterministisch lexicon vóór de LLM-call.** Medische termen als regex.
   Match betekent `inDomain: false`, geen enkel model ziet de body, en het
   bericht gaat ongelezen naar de HR-postbus met een `hr_escalation` zonder body.

---

## 4. Taxonomie

Per module, in `packages/agent-core/src/modules/hr.ts` via een eigen
`HR_CATEGORIES`-lijst. De hint gaat letterlijk in de classify-prompt.

| slug | label | specialist | hint |
|---|---|---|---|
| `vacature_intake` | Vacature-intake | `hr_vacancy` | nieuwe vacature aanvragen of functieprofiel laten opstellen. Alleen bij een expliciete aanvraag van een manager |
| `sollicitatie_nieuw` | Nieuwe sollicitatie | `hr_candidate` | binnengekomen sollicitatie met cv of motivatie, uit ATS of per mail |
| `sollicitatie_vraag` | Vraag van kandidaat | `hr_correspondence` | kandidaat vraagt naar status, procedure, reiskosten of planning |
| `sollicitatie_planning` | Gespreksplanning | `hr_correspondence` | inplannen, verzetten of bevestigen van een sollicitatiegesprek |
| `kandidaat_stil` | Kandidaat zonder reactie | `hr_candidate` | kandidaat wacht langer dan de afgesproken termijn. Komt van de cron, niet uit een bericht |
| `onboarding` | Onboarding | `hr_onboarding` | nieuwe medewerker: werkplek, toegang, documenten, introductieprogramma |
| `verlof_regeling` | Verlof en regelingen | `hr_helpdesk` | verlofsaldo, opnemen, ouderschapsverlof, reiskosten, thuiswerkregeling |
| `declaratie` | Declaratie | `hr_helpdesk` | onkosten, reiskosten, studiekosten indienen of navragen |
| `verzuim_proces` | Verzuim (proces) | `hr_absence_process` | uitsluitend termijnen en stappen uit de Wet verbetering poortwachter. NOOIT de reden of de klacht |
| `contract_document` | Contract en documenten | `hr_contract` | arbeidsovereenkomst, verlenging, wijziging, werkgeversverklaring, kopie loonstrook |
| `loonrun` | Loonrun | `hr_payroll_check` | mutaties voor de loonrun, controle vóór verzending, vragen over een loonstrook |
| `uitdiensttreding` | Uitdiensttreding | `hr_contract` | opzegging, eindafrekening, inleveren middelen, exitgesprek plannen |
| `medisch_afgekapt` | Medische inhoud | `hr_escalate` | bericht bevat gezondheidsinformatie. Geen verwerking, geen samenvatting, direct naar een mens |
| `hr_overig` | Overig | `hr_escalate` | te vaag om te routeren, of een conflict, klacht of vertrouwenszaak |

---

## 5. Specialisten

Vorm van `IntentConfig`. **Alle specialisten hier hebben `needsHitl: true`.** Dat
is de AI Act-inrichting, geen voorzichtigheid: zodra één uitkomst zonder mens naar
buiten kan, is het systeem geen hulpmiddel meer maar een beslisser over een
natuurlijk persoon. Die grens loopt precies langs dit vinkje.

| id | displayName | description (router-prompt) | toolScope | memoryProcessTag | tier | confidence | needsHitl |
|---|---|---|---|---|---|---|---|
| `hr_candidate` | Kandidaatdossier | Sollicitatie binnen of kandidaat wacht te lang; vat cv en motivatie feitelijk samen tegen de vacature-eisen. | `ats.get_vacancy`, `ats.get_application`, `docs.extract_text` | `recruitment` | `plan-heavy` | 0.85 | true |
| `hr_correspondence` | Kandidaatcorrespondentie | Bericht van of aan een kandidaat over status, procedure of planning. | `ats.get_application`, `ats.list_stages`, `calendar.find_slots` | `recruitment` | `plan` | 0.8 | true |
| `hr_vacancy` | Vacature en functieprofiel | Manager vraagt een vacature of functieprofiel aan; concepttekst uit de intake. | `hris.get_org_unit`, `ats.list_vacancies` | `vacature` | `plan` | 0.8 | true |
| `hr_onboarding` | Onboarding | Nieuwe medewerker: taken uitzetten, status bewaken, herinneren. | `hris.get_employee`, `tasks.list_onboarding`, `tasks.create` | `onboarding` | `plan` | 0.8 | true |
| `hr_helpdesk` | HR-helpdesk | Vraag over verlof, regeling of declaratie; antwoordt uit personeelsgids en verlofsaldo. | `kb.search_policy`, `hris.get_leave_balance`, `hris.get_employee` | `helpdesk` | `plan` | 0.8 | true |
| `hr_absence_process` | Verzuim (procesbewaking) | Poortwachter-termijn aan de orde. Alleen datums en stappen, nooit inhoud. | `absence.get_process_steps`, `calendar.find_slots` | `verzuim_proces` | `plan` | 0.9 | true |
| `hr_contract` | Contract en documenten | Contract, verlenging, verklaring of uitdiensttreding voorbereiden. | `hris.get_contract`, `docs.render_template` | `contract` | `plan` | 0.9 | true |
| `hr_payroll_check` | Loonruncontrole | Mutaties vóór de loonrun vergelijken met de vorige periode. | `payroll.get_period_mutations`, `payroll.get_previous_period` | `loonrun` | `plan` | 0.9 | true |

`hr_escalate` is de fallback en heeft `toolScope: []`.

**systemPrompt-beslisstappen:**

- `hr_candidate`: haal vacature-eisen op, haal cv-tekst op, noteer per eis of het
  cv daar iets over zegt met citaat en bron, noteer wat je niet kon vaststellen
  als open punt. Geen score, geen rangorde, geen advies, niet de woorden geschikt,
  sterk, zwak of afwijzen. Sluit af met "beoordeling door de recruiter".
- `hr_correspondence`: bepaal de fase, antwoord alleen over proces en planning,
  doe nooit een uitspraak over de uitkomst.
- `hr_helpdesk`: zoek de regeling, citeer de passage met versie, staat het er niet
  dan zeg je dat en zet je door. Verzin nooit een aanspraak.
- `hr_absence_process`: lees alleen stapnaam, datum en status, bepaal welke termijn
  nadert, schrijf een herinnering die alleen stap en datum noemt. Elke inhoudelijke
  beschrijving van de situatie is een fout, ook als die in de bron staat.
- `hr_payroll_check`: vergelijk met de vorige periode, meld afwijkingen als vraag,
  stel nooit zelf een bedrag voor.

---

## 6. Feiten en MCP-tools

Nieuw te bouwen MCP-servers: `factumai-mcp-hris`, `factumai-mcp-ats`,
`factumai-mcp-payroll`, `factumai-mcp-absence`. `docs`, `calendar`, `kb` en
`tasks` zijn uitbreidingen op bestaande servers.

| tool | doelsysteem | invoer | uitvoervelden | dataCategories | waarom nodig voor grounding |
|---|---|---|---|---|---|
| `hris.get_employee` | AFAS / Nmbrs / Personio | `employeeId` of `workEmail` | `employeeId, name, workEmail, department, managerId, startDate, contractType, fte` | `persoonsgegevens` | Zonder match geen enkel personeelsfeit in een concept |
| `hris.get_leave_balance` | AFAS / Loket | `employeeId, year` | `balanceHours, takenHours, entitlementHours, expiryDate` | `persoonsgegevens` | Saldo noemen zonder deze call is een verzonnen aanspraak |
| `hris.get_contract` | AFAS / Personio | `employeeId` | `contractId, type, startDate, endDate, noticeDays, hoursPerWeek` | `persoonsgegevens` | Termijnbewaking hangt hier volledig aan |
| `hris.get_org_unit` | AFAS | `departmentId` | `departmentId, name, managerId, headcount` | `operationeel` | Routering naar de juiste manager |
| `ats.get_vacancy` | Recruitee / Homerun | `vacancyId` | `vacancyId, title, requirements[], department, status, publishedAt` | `operationeel` | De eisenlijst waartegen wordt samengevat |
| `ats.get_application` | Recruitee / Homerun | `applicationId` | `applicationId, candidateName, email, stage, appliedAt, lastContactAt, cvFileId` | `persoonsgegevens` | Statusuitspraken moeten uit de bron komen |
| `ats.list_stale_applications` | Recruitee / Homerun | `days` | `[{applicationId, candidateName, stage, daysSinceLastContact}]` | `persoonsgegevens` | Voedt de cron; zonder deze lijst is stilte onzichtbaar |
| `docs.extract_text` | Supabase storage | `fileId` | `text, pageCount` | `persoonsgegevens` | Enige toegestane bron voor citaten |
| `kb.search_policy` | Personeelsgids | `query` | `passages[{title, text, sourceRef, version}]` | `operationeel` | Elk regelingantwoord citeert een passage met versie |
| `absence.get_process_steps` | Verzuimsysteem | `absenceId` | `steps[{step, dueDate, completedAt, status}]` | `persoonsgegevens` | Alleen procesfeiten, alleen termijnbewaking |
| `payroll.get_period_mutations` | Nmbrs / Loket | `periodId` | `mutations[{employeeId, field, oldValue, newValue}]` | `persoonsgegevens` | Afwijking melden zonder mutatierij is een gok |
| `calendar.find_slots` | M365 | `attendees[], durationMin, window` | `slots[{start, end}]` | `operationeel` | Voorgestelde tijd moet uit de agenda komen |
| `docs.render_template` | intern | `templateId, vars` | `fileId, previewUrl` | `persoonsgegevens` | Controleerbare bron per veld |

**Nooit ophalen, in geen enkele tool:** diagnose, klacht, symptoom, behandeling,
medicatie, arts, verwachte hersteldatum, arbeidsdeskundig oordeel en alle
vrije tekst uit een verzuimdossier. BSN, geboortedatum, bankrekening,
nationaliteit, geboorteland, burgerlijke staat, gezinssamenstelling, kandidaatfoto.
Functionerings- en beoordelingsscores, verzuimfrequentie per persoon,
leidinggevendenotities over een medewerker.

Dit is een filter in de MCP-laag, geen prompt-instructie: een veld dat niet uit de
MCP komt kan de agent niet citeren. Patroon in `docs/VELDCLASSIFICATIE.md`.

---

## 7. ReviewItem-kinds en `proposed`

| kind | wanneer | approver |
|---|---|---|
| `candidate_summary` | nieuwe sollicitatie of stille kandidaat | reviewer |
| `job_posting` | vacaturetekst of functieprofiel | admin |
| `hr_reply` | antwoord aan medewerker of kandidaat | reviewer |
| `onboarding_plan` | onboardingtaken en herinneringen | reviewer |
| `contract_document` | contract, verlenging, verklaring | admin |
| `payroll_check` | afwijkingen vóór de loonrun | admin |
| `hr_escalation` | medische inhoud, conflict, onbekend | reviewer |

```jsonc
// candidate_summary
{ "applicationId": "APP-2291",
  "vacancy": { "id": "VAC-14", "title": "Werkvoorbereider",
               "requirements": ["MBO4 bouwkunde", "Revit", "rijbewijs B"] },
  "candidate": { "name": "Bram Kuipers", "appliedAt": "2026-08-12" },
  "findings": [
    { "requirement": "MBO4 bouwkunde", "found": true, "quote": "MBO4 Bouwkunde, ROC Horizon, 2019",
      "source": { "tool": "docs.extract_text", "toolCallId": "tc_3" } },
    { "requirement": "Revit", "found": false, "quote": null, "note": "cv noemt AutoCAD" } ],
  "openPoints": ["rijbewijs staat niet in het cv"],
  "notice": "Samenvatting van wat in het cv staat. Beoordeling door de recruiter." }

// hr_reply
{ "to": "m.dijkstra@example.com", "subject": "Je verlofsaldo", "body": "...",
  "citations": [{ "sourceRef": "personeelsgids-v2026.1 §4.2", "toolCallId": "tc_1" }] }

// onboarding_plan
{ "employeeId": "EMP-882", "startDate": "2026-09-01", "reminderTo": ["teamleider@example.com"],
  "tasks": [{ "taskId": "t3", "label": "Laptop bestellen", "owner": "ict@example.com",
              "dueDate": "2026-08-25", "status": "open" }] }

// contract_document
{ "employeeId": "EMP-104", "docType": "verlenging", "contractId": "CT-88",
  "fields": [{ "name": "endDate", "value": "2026-11-30", "toolCallId": "tc_1" }] }

// payroll_check
{ "periodId": "2026-08", "questions": [{ "employeeId": "EMP-104", "field": "hoursPerWeek",
  "oldValue": 32, "newValue": 40, "question": "Is deze urenwijziging bedoeld?", "toolCallId": "tc_2" }] }

// job_posting
{ "vacancyId": "VAC-14", "title": "Werkvoorbereider", "body": "...",
  "transparencyNotice": "Bij de verwerking van sollicitaties gebruiken wij AI om cv's samen te vatten. De beoordeling doet een mens." }

// hr_escalation
{ "reason": "medische_inhoud", "bodyIncluded": false,
  "note": "Bevat gezondheidsinformatie. Niet verwerkt, niet samengevat. Origineel staat in de HR-postbus." }
```

**`toCard`-viewmodel:**

| kind | titel / ondertitel | badges |
|---|---|---|
| `candidate_summary` | vacaturetitel / kandidaatnaam | categorie, `2 open punten`, `Beoordeling door mens` |
| `hr_reply` | onderwerp / naam medewerker | categorie, specialist |
| `onboarding_plan` | `Onboarding {naam}` / startdatum | `3 taken open`, `1 over datum` |
| `contract_document` | documenttype / naam | `admin vereist`, deadline |
| `payroll_check` | `Loonrun {periode}` / `{n} afwijkingen` | `admin vereist` |
| `hr_escalation` | `Bericht naar HR` / afzender | `Niet verwerkt` (alert) |

De kaart van een `candidate_summary` toont nooit een score, percentage, rangorde,
kleurcode of het woord afwijzen. Alleen een samenvatting met bron plus wat niet
vastgesteld kon worden. Een badge die "2 van 3 eisen" telt is al een
rangschikkingssignaal en hoort er dus niet.

---

## 8. Actietypen

Vorm van `ACTION_TYPES` uit `packages/agent-core/src/actions/index.ts`. Alle
typen zijn `channels: ['mail']`; er is geen anoniem chatkanaal in dit domein.

| slug | target | preconditionKind | impact | approverRole | expiresAfterMinutes | payloadFields |
|---|---|---|---|---|---|---|
| `hr_ticket_aanmaken` | `tickets` / `create_ticket` | `geen` | Intern uitzoekpunt voor HR | reviewer | 10080 | `subject` (bericht, editable), `description` (bericht, editable) |
| `kandidaat_status_bijwerken` | `ats` / `update_application_stage` | `sollicitatiestatus` | Kandidaat schuift een fase op | reviewer | 1440 | `applicationId`, `stage`, `reason` (bericht, editable) |
| `sollicitatiegesprek_inplannen` | `calendar` / `create_event` | `geen` | Afspraak in de agenda's | reviewer | 720 | `applicationId`, `start`, `end`, `attendees` |
| `kandidaat_bevestiging_sturen` | `mail` / `send_reply` | `sollicitatiestatus` | Bericht gaat naar de kandidaat | reviewer | 1440 | `applicationId`, `subject` (editable), `body` (editable) |
| `vacature_publiceren` | `ats` / `publish_vacancy` | `vacaturestatus` | Vacature komt publiek online | admin | 1440 | `vacancyId`, `title` (editable), `body` (editable) |
| `onboardingtaak_aanmaken` | `tasks` / `create_task` | `geen` | Taak bij een collega in de lijst | reviewer | 10080 | `employeeId`, `label` (editable), `owner`, `dueDate` (editable) |
| `onboarding_herinnering_sturen` | `mail` / `send_reply` | `geen` | Herinnering aan een interne collega | reviewer | 1440 | `taskId`, `to`, `body` (editable) |
| `verzuimafspraak_inplannen` | `calendar` / `create_event` | `verzuimstap` | Afspraak medewerker en leidinggevende | reviewer | 720 | `absenceId`, `wvpStep`, `start`, `end` |
| `verzuimtermijn_signaleren` | `tasks` / `create_task` | `verzuimstap` | Interne taak, stapnaam en datum, zonder inhoud | reviewer | 4320 | `absenceId`, `wvpStep`, `dueDate` |
| `contractsignaal_aanmaken` | `tasks` / `create_task` | `contractstatus` | Signaal vóór de opzegdeadline | admin | 20160 | `employeeId`, `contractId`, `noticeDeadline` |
| `werkgeversverklaring_genereren` | `docs` / `render_template` | `contractstatus` | PDF met loon- en contractdata | admin | 1440 | `employeeId`, `templateId`, `vars.grossSalary`, `vars.contractType` |
| `loonrunvraag_aanmaken` | `tasks` / `create_task` | `geen` | Vraag aan de salarisadministratie | admin | 2880 | `periodId`, `employeeId`, `question` (editable) |

Nieuwe `PRECONDITION_KINDS`: `sollicitatiestatus` (`applicationId, stage,
lastContactAt`), `vacaturestatus` (`vacancyId, status`), `contractstatus`
(`contractId, status, endDate`), `verzuimstap` (`absenceId, wvpStep, status`).

Er bestaat geen actietype voor afwijzen, aannemen, functioneringsoordeel,
salariswijziging, ontslag of taaktoewijzing. Dat is de grens, niet een omissie:
een actietype dat niet bestaat kan een model niet voorstellen.

---

## 9. Uitkomsten en identificatie

| uitkomst | wanneer in dit domein |
|---|---|
| `kennis` | Antwoord staat woordelijk in de personeelsgids en gaat over iedereen (verlofregeling, reiskostenregeling). Geen persoonsgegeven nodig |
| `systeem` | Er komt een persoonlijk feit uit een bron: verlofsaldo, contractdatum, sollicitatiefase. Alleen bij bevestigde identificatie |
| `taak` | Alles wat een mens moet doen of beoordelen: kandidaatsamenvatting, contractsignaal, verzuimtermijn, loonrunvraag |
| `onbekend` | Te vaag om te routeren. Doorvragen, geen ticket |

Ook `kennis` en `systeem` worden hier een ReviewItem, net als bij mail in
klantenservice. Er is geen kanaal in dit domein waarop iets direct naar buiten mag.

**Identificatie is strenger dan bij klantenservice.** `senderAddressSuffices` is
hier `false` voor elk kanaal. Voordat er één personeelsgegeven in een concept of
uitgaand bericht staat: het afzenderadres is een zakelijk adres dat
`hris.get_employee` daadwerkelijk teruggaf. Een privéadres levert nooit
`gematcht` op, ook niet als de naam klopt. Voor `contract_document` en
`werkgeversverklaring_genereren` geldt `requiredIdentification: 'bevestigd'`; dat
mechanisme bestaat nog niet, dus die typen ontstaan voorlopig niet. Dat is de
bedoelde rem.

Kandidaten zijn nooit `gematcht`, want een sollicitant staat niet in het HRIS.
Voor hen gelden alleen ATS-procesfeiten, en uitsluitend als `applicationId` uit de
webhook komt en niet uit een mail.

---

## 10. Schermen, rollen en tabellen

**Nav-items op de module** (`ui/lib/modules/hr.ts`, `order: 40`), elk achter
`requireModulePage('hr')` en `requireModule('hr', 'reviewer')`:

| pagina | wat |
|---|---|
| `/vacatures` | Vacatures met openstaande kandidaten en doorlooptijd per fase |
| `/kandidaten/[id]` | Kandidaatdossier: samenvatting, bron per bevinding, correspondentie |
| `/onboarding` | Onboardingplannen met open en verlopen taken |
| `/hr-signalen` | Contract- en verzuimtermijnen, uitsluitend datums en stapnamen |
| `/personeelsgids` | Beheer van de kennisbron met versie per passage |

**Nieuwe tabellen:**

```
aios_hr_candidates       id pk, organization_id, application_id, vacancy_id,
                         candidate_ref (pseudoniem), stage, applied_at,
                         last_contact_at, summary_review_item_id, created_at
  uniq (organization_id, application_id)
  idx  (organization_id, vacancy_id, stage)
  idx  (organization_id, last_contact_at) where stage not in ('hired','closed')

aios_hr_onboarding_tasks id pk, organization_id, employee_id, plan_id, label,
                         owner_email, due_date, status check(open|done|cancelled),
                         completed_at, created_at
  idx  (organization_id, status, due_date)

aios_hr_process_deadlines id pk, organization_id,
                         subject_type check(contract|verzuim),
                         subject_ref (contractId of absenceId, nooit inhoud),
                         step, due_date, status, signalled_at
  idx  (organization_id, subject_type, due_date)
  -- harde regel: geen enkele vrije-tekstkolom in deze tabel

aios_hr_policy_sources   id pk, organization_id, title, body, version,
                         effective_from, created_at
  idx  (organization_id, effective_from desc)
```

Bestaande tabellen die een `module`-kolom nodig hebben: `aios_tickets`,
`aios_proposed_actions`, `aios_decision_logs`, `aios_conversations`.
`aios_review_items` heeft hem al (migratie 0030).

**Rolrechten, strenger dan elders.** `docs/RECHTEN.md` kent drie
datacategorieën. Deze module voegt er twee toe: `persoonsgegevens` en
`bijzonder`.

| rol | module | categories |
|---|---|---|
| `viewer` | `hr` | `{}` (leeg: een viewer ziet in HR niets) |
| `reviewer` | `hr` | `{operationeel}` |
| `admin` | `hr` | `{operationeel,persoonsgegevens}` |
| elke rol | `hr` | `bijzonder` bestaat als categorie en wordt aan **niemand** verleend |

Gevolgen: de default `'*'`-rij (`{operationeel}`) geeft in HR geen toegang tot
personeelsgegevens, dus een reviewer ziet de kaart en de samenvatting maar niet de
contractgegevens erachter. `bijzonder` bestaat zodat de MCP zulke velden kan
herkennen en wegsnijden, en is aan niemand verleend, dus geen rol kan hem
opvragen. `AGENT_DATA_CATEGORIES` voor de HR-agent wordt
`operationeel,persoonsgegevens`, nooit `bijzonder` en nooit `financieel`.

---

## 11. Demo-scenario's

| # | scenario | verwachte uitkomst |
|---|---|---|
| 1 | Webhook: Bram Kuipers solliciteert op VAC-14 Werkvoorbereider bij Van Doorn Bouw, cv als PDF | `candidate_summary`: drie eisen, twee met citaat, Revit niet gevonden, open punt rijbewijs. Geen score, geen advies |
| 2 | Cron: APP-2255, Nadia el Amrani, staat 11 dagen op fase `screening` zonder contact | `hr_reply` met stand van zaken plus `kandidaat_status_bijwerken`. Beide PENDING |
| 3 | Mail van `m.dijkstra@example.com`: "hoeveel verlofuren heb ik nog dit jaar?" | Match via `hris.get_employee`, saldo 62 uur, `hr_reply` met citaat personeelsgids v2026.1 §4.2 |
| 4 | Mail van `nadia.privemail@example.com`: "hierbij mijn loonstrook-vraag, ik ben Nadia van de afdeling planning" | Geen zakelijk adres, dus geen `gematcht`. Uitkomst `taak`, ReviewItem zonder personeelsgegevens, met de reden erbij |
| 5 | Mail van een teamleider: "Jeroen is uitgevallen met een hernia, hij is minimaal zes weken uit de running, wat moet ik nu doen?" | Lexicon matcht. Gate `inDomain: false`, reden `medische inhoud`. `hr_escalation` met `bodyIncluded: false`, geen samenvatting, geen model heeft de body gezien. Origineel blijft in de HR-postbus |
| 6 | Webhook verzuim: ABS-77, stap `plan van aanpak`, deadline over 4 dagen, geen inhoud in de payload | `verzuimtermijn_signaleren` plus `verzuimafspraak_inplannen`. Concepttekst: "Voor ABS-77 staat de stap plan van aanpak op 12 september. Er is nog geen afspraak ingepland." Geen woord over de reden |
| 7 | Cron contract: EMP-104, jaarcontract eindigt 30 november, opzegdeadline 31 oktober | `contractsignaal_aanmaken`, approver `admin`, deadlinebadge. Geen advies over wel of niet verlengen |
| 8 | Mail van een manager: "Sanne functioneert niet, kunnen jullie een dossier opbouwen?" | Categorie `hr_overig`, specialist `hr_escalate`. Geen samenvatting, geen dossier, geen actietype beschikbaar. ReviewItem met als reden dat beoordelen van functioneren buiten de agent valt |

---

## 12. Analytics en waarde

**Wel in de cockpit, allemaal op procesniveau en geaggregeerd:**

| KPI | eenheid |
|---|---|
| Doorlooptijd per sollicitatiefase | dagen, mediaan per vacature |
| Kandidaten zonder reactie boven de afgesproken termijn | aantal |
| Onboardingtaken open en over datum | aantal, per week |
| Contractdeadlines gehaald binnen de opzegtermijn | percentage |
| Verzuimprocesstappen op tijd afgerond | percentage, zonder personen te tonen |
| HR-helpdeskvragen per categorie | aantal per maand |
| Voorstellen goedgekeurd, bewerkt, afgewezen | aantal per kind |
| Voorstellen waar een reviewer de tekst aanpaste | percentage per specialist |

**Bewust niet, omdat het naar profilering neigt:**

- Verzuimfrequentie of verzuimduur per medewerker of team.
- Ranglijsten van kandidaten, matchpercentages, geschiktheidsscores.
- Doorlooptijd of responssnelheid per individuele HR-medewerker.
- Afwijzingsredenen uitgesplitst naar herkomst, opleiding of woonplaats. Dat is
  een discriminatiemeting die je niet wil kunnen maken.
- Alles wat een medewerker langs een andere medewerker legt.

---

## 13. Risico's en grenzen

**EU AI Act.** Werving, selectie en beslissingen over promotie, ontslag,
taaktoewijzing en prestatie-evaluatie staan in Annex III. Onze inrichting:

| verplichting | invulling |
|---|---|
| Menselijk toezicht (art. 14) | `needsHitl: true` op elke specialist, geen autonoom uitgaand pad, elke actie langs de werkbak |
| Logging (art. 12) | `aios_decision_logs`: per run model, specialist, tool-calls, confidence, beslissing. 365 dagen bewaartermijn |
| Transparantie richting kandidaten (art. 26 lid 7 en art. 13/14 AVG) | Vaste passage in elke vacature en ontvangstbevestiging: AI vat samen, een mens beoordeelt, bezwaar en toelichting mogelijk |
| Risicobeoordeling | Per agent vóór livegang: beoogd gebruik, databronnen, vorm van toezicht |
| Grens | De agent rangschikt, scoort en adviseert niet. Hij vat samen en noemt zijn bron. Zodra hij een volgorde of oordeel produceert is het een selectiesysteem |

Verboden praktijken (art. 5) blijven ver buiten scope: emotieherkenning op de
werkplek, biometrische categorisering, gedragsvoorspelling. Geen video- of
stemanalyse van sollicitatiegesprekken.

**AVG artikel 22.** De agent mag samenvatten en voorbereiden. Hij mag niet
afwijzen, aannemen, ontslaan of ordenen op geschiktheid. Afgedwongen op drie
plekken tegelijk: het actietype bestaat niet, de `proposed`-vorm heeft geen
scoreveld, en de kaart heeft geen plek om er een te tonen. Een prompt-instructie
alleen is hier onvoldoende.

**Verzuim.** De agent verwerkt geen medische inhoud, ook niet om samen te vatten
en ook niet om vast te stellen dát iets medisch is; dat doet het lexicon. Hij ziet
stapnaam, datum en status. `aios_hr_process_deadlines` heeft geen vrije-tekstkolom,
dus er is geen plek waar het alsnog kan landen.

**Bewust niet geautomatiseerd:** afwijzingsbrieven, cv-scores, ranglijsten,
functioneringsverslagen, ontslagdossiers, beoordeling van geschiktheid,
arbeidsconflicten, vertrouwenspersoonzaken, salarisbesluiten, en elke
communicatie over de medische situatie van een medewerker.

**Documentatie die de klant krijgt:** DPA met deze module als bijlage,
verwerkingsregister met de HR-verwerkingen apart, DPIA (bij werving verplicht),
AI Act-classificatie per agent, sub-processorlijst, de transparantiepassage voor
vacatures en bevestigingen, en een uitleg van de bezwaarprocedure onder art. 21.

---

## 14. Bouwvolgorde

**Stap 1, kleinste veilige demo.** Domain-gate met lexicon, drie categorieën
(`verlof_regeling`, `medisch_afgekapt`, `hr_overig`), één specialist
(`hr_helpdesk`), één kind (`hr_reply`), één actietype (`hr_ticket_aanmaken`),
`kb.search_policy` en `hris.get_employee` als enige tools. Dit toont de hele lus
inclusief het afkappen van een verzuimmail en raakt geen Annex III-toepassing.

**Stap 2.** `hr_onboarding` met `aios_hr_onboarding_tasks` en de cron. Interne
taken, geen kandidaten, geen persoonsbeoordeling.

**Stap 3.** `hr_contract` beperkt tot signalering, nog geen documentgeneratie.

**Stap 4.** Recruitment: eerst `hr_correspondence` (planning en status), daarna
pas `hr_candidate` met `candidate_summary`. Vóór livegang moeten de AI
Act-classificatie, de DPIA en de transparantiepassage af zijn, en moet de klant
schriftelijk bevestigen dat de recruiter beoordeelt.

**Stap 5.** `hr_absence_process`. Bewust laat: lexicon en kolomdiscipline moeten
zich eerst in productie bewezen hebben.

**Stap 6.** `hr_payroll_check` en `hr_vacancy`. `werkgeversverklaring_genereren`
wacht op het bevestigde-identificatiemechanisme en ontstaat tot die tijd niet.

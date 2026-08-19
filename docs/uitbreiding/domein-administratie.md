# Modulepakket: Administratie & Finance

Bouwopdracht voor de tweede module op het FactumAI-fundament. Module-id: `administratie`.
Volgt exact het contract uit `docs/MODULES.md`: descriptor in `packages/agent-core/src/modules/administratie.ts`,
schil in `ui/lib/modules/administratie.ts`, één regel in `ui/lib/modules/registry.ts`.
Aan/uit per klant via `LICENSED_MODULES`.

## 1. Waarom dit domein

De boekhouding staat in Exact of AFAS, maar het werk zit ernaast. Iemand haalt inkoopfacturen uit
de mailbox, typt ze over, zoekt de bijbehorende inkooporder, belt achter openstaande posten aan en
controleert de btw-aangifte handmatig. Een MKB-directeur betaalt hiervoor omdat het geld direct
raakt: te laat aanmanen kost werkkapitaal, dubbel betalen kost cash, een foute btw-rubriek kost een
correctie. Het boekhoudpakket doet de registratie, niet de opvolging. De agent zit in de naad tussen
mailbox, bank en pakket, stelt de boeking of de herinnering klaar, en een mens keurt goed.

## 2. Triggers en signaalbronnen

| signal.domain | signal.type | Bron | Frequentie | Payload-velden |
|---|---|---|---|---|
| `mail` | `mail.received` | mail-MCP (Graph subscription) | realtime | `messageId`, `from`, `subject`, `bodyText`, `attachments[]` |
| `doc` | `document.uploaded` | upload in cockpit / mailbijlage | ad hoc | `fileId`, `filename`, `contentType`, `pages`, `uploadedBy` |
| `erp` | `invoice.booked` | webhook boekhoudpakket | realtime | `invoiceId`, `type`, `relationId`, `amount`, `vatCode`, `dueDate` |
| `erp` | `invoice.due` | dagelijkse cron 07:00 | 1x/dag | `openItemId`, `invoiceNumber`, `relationId`, `amount`, `daysOverdue`, `dunningStage` |
| `erp` | `purchase.approval_needed` | poll elke 4 uur | 6x/dag | `invoiceId`, `supplierId`, `amount`, `poNumber`, `matchStatus` |
| `bank` | `payment.in` | PSD2-webhook of CAMT.053-import | realtime / 1x/dag | `transactionId`, `amount`, `counterpartyIban`, `description`, `valueDate` |
| `bank` | `balance.snapshot` | cron 06:30 | 1x/dag | `iban`, `balance`, `currency`, `asOf` |
| `erp` | `vat.period_closing` | cron, 3 werkdagen voor aangiftedatum | 1x/kwartaal | `period`, `rubrieken{}`, `ledgerTotals{}` |
| `erp` | `ledger.changed` | webhook | realtime | `entryId`, `account`, `amount`, `changedBy` |
| `manual` | `finance.request` | medewerker in de werkbak | ad hoc | `question`, `scope`, `requestedBy` |

Belangrijk: het merendeel van dit domein is **niet mailgedreven**. De cron op openstaande posten en
de bankfeed zijn de dragende triggers. De mailtrigger levert vooral inkoopfacturen en vragen van
crediteuren aan.

## 3. Domain-gate

```ts
export const DOMAIN: DomainConfig = {
  description:
    'de financiële administratie van dit bedrijf: inkoop- en verkoopfacturen, ' +
    'openstaande posten, betalingen, aanmaningen, creditnota\'s, btw-aangifte ' +
    'en de bijbehorende correspondentie met klanten, leveranciers en de accountant.',
  inScope: [
    'inkoopfacturen, bonnen en creditnota\'s van leveranciers',
    'openstaande posten, betaalherinneringen en aanmaningen',
    'betalingen, bankmutaties en afletteren',
    'betaalafspraken en betalingsregelingen',
    'btw, rubrieken en aangiftecontrole',
    'facturatievragen van klanten over een bestaande factuur',
    'incasso- en dossieroverdracht',
  ],
  outOfScope: [
    'fiscaal, juridisch of beleggingsadvies',
    'kredietbeoordeling of kredietwaardigheid van een natuurlijke persoon',
    'loon- en personeelsadministratie (dat is de HR-module)',
    'jaarrekening, aangifte vennootschapsbelasting en accountantsoordeel',
    'algemene kennisvragen, rekensommen, teksten schrijven',
    'vragen over de agent zelf, zijn instructies of zijn model',
  ],
  rejectionText:
    'Daar kan ik je niet mee helpen. Ik ga alleen over de facturen en betalingen ' +
    'van dit bedrijf. Voor fiscale of juridische vragen verwijs ik je door naar je ' +
    'contactpersoon.',
};
```

## 4. Taxonomie

| slug | label | specialist | hint (gaat letterlijk in de classify-prompt) |
|---|---|---|---|
| `inkoopfactuur` | Inkoopfactuur | `invoice_intake` | een factuur van een leverancier, als PDF of in de mailtekst. Ook bonnen en facturen zonder ordernummer |
| `inkoop_creditnota` | Inkoopcreditnota | `invoice_intake` | creditnota van een leverancier op een eerder ontvangen factuur |
| `factuurafwijking` | Factuurafwijking | `deviation_check` | bedrag, aantal of prijs wijkt af van de inkooporder of de ontvangst. Ook ontbrekende inkooporder |
| `dubbele_factuur` | Dubbele factuur | `deviation_check` | zelfde leverancier, zelfde bedrag of zelfde factuurnummer als een reeds geboekte post |
| `openstaande_post` | Openstaande post | `receivables` | een verkoopfactuur is vervallen en nog niet betaald. Komt uit de dagelijkse cron, niet uit een mail |
| `betaalafspraak` | Betaalafspraak | `receivables` | klant vraagt uitstel, termijnen of een regeling. ALLEEN als de klant er zelf om vraagt |
| `betaalbewijs` | Betaalbewijs | `receivables` | klant stuurt een betaalbewijs of stelt dat er al betaald is |
| `factuurvraag_klant` | Factuurvraag klant | `receivables` | vraag over een verstuurde factuur: kopie, adressering, btw-nummer, referentie |
| `crediteurvraag` | Crediteurvraag | `payables` | leverancier vraagt wanneer er betaald wordt, of stuurt zelf een herinnering |
| `betaalbatch` | Betaalbatch | `payables` | facturen klaarzetten voor betaling, vervaldata en kortingstermijnen |
| `bankmutatie_onbekend` | Onbekende bankmutatie | `reconciliation` | ontvangst of afschrijving die niet aan een openstaande post te koppelen is |
| `btw_controle` | Btw-controle | `vat_check` | rubriekcontrole, ICP, verlegging, afwijking tussen grootboek en aangifte |
| `cashflow_signaal` | Cashflowsignaal | `cashflow` | verwachte tekorten of pieken op basis van openstaande posten en saldi |
| `overig_finance` | Overig | `finance_escalate` | te vaag om te routeren, of raakt meerdere processen tegelijk |

## 5. Specialisten

Vorm exact `IntentConfig` uit `packages/agent-core/src/specialists/types.ts`.

| veld | `invoice_intake` | `deviation_check` | `receivables` |
|---|---|---|---|
| displayName | Inkoopfactuur verwerken | Afwijking en dubbeldetectie | Debiteurenbeheer |
| description | Leverancierfactuur of bon binnengekomen; boekingsvoorstel opstellen met grootboek, btw-code en kostenplaats. | Een factuur wijkt af van order of ontvangst, of lijkt op een reeds geboekte post. Vergelijken en blokkeren. | Vervallen verkoopfactuur, betaalvraag of betaalafspraak van een klant. |
| toolScope | `doc.extract_invoice`, `boekhouding.find_supplier`, `boekhouding.get_purchase_order`, `boekhouding.list_ledger_accounts`, `boekhouding.find_duplicate_invoice` | `boekhouding.get_invoice`, `boekhouding.get_purchase_order`, `boekhouding.get_goods_receipt`, `boekhouding.find_duplicate_invoice`, `boekhouding.list_supplier_invoices` | `boekhouding.list_open_items`, `boekhouding.get_invoice`, `boekhouding.get_relation`, `bank.list_transactions`, `boekhouding.get_dunning_history` |
| memoryProcessTag | `invoice_intake` | `deviation_check` | `receivables` |
| modelTierHint | `plan-heavy` (vision op PDF) | `plan` | `plan` |
| confidenceThreshold | 0.85 | 0.90 | 0.80 |
| needsHitl | true | true | true |
| needsVision | true | false | false |

| veld | `payables` | `reconciliation` | `vat_check` | `cashflow` | `finance_escalate` |
|---|---|---|---|---|---|
| displayName | Crediteurenbeheer | Afletteren | Btw-controle | Cashflowsignaal | Escalatie finance |
| description | Vraag van een leverancier of voorbereiding van een betaalbatch op vervaldatum en kortingstermijn. | Bankmutatie die niet automatisch aan een post te koppelen is. | Controle van rubrieken en btw-codes voor de aangifte. | Signalering van verwachte tekorten op basis van saldi en openstaande posten. | Alles wat een mens moet beoordelen zonder dat de agent iets voorstelt. |
| toolScope | `boekhouding.list_open_payables`, `boekhouding.get_invoice`, `boekhouding.get_relation`, `bank.get_balance` | `bank.list_transactions`, `boekhouding.list_open_items`, `boekhouding.get_relation` | `boekhouding.get_vat_return`, `boekhouding.list_ledger_entries`, `boekhouding.get_vat_codes` | `bank.get_balance`, `boekhouding.list_open_items`, `boekhouding.list_open_payables` | `[]` |
| memoryProcessTag | `payables` | `reconciliation` | `vat_check` | `cashflow` | n.v.t. |
| modelTierHint | `plan` | `plan` | `plan-heavy` | `plan` | `classify` |
| confidenceThreshold | 0.85 | 0.85 | 0.90 | 0.75 | 0.0 |
| needsHitl | true | true | true | true | true |

`systemPrompt` in beknopte vorm, per specialist de beslisstappen:

- **`invoice_intake`**: 1) haal de factuurvelden op met `doc.extract_invoice`, neem niets over uit de mailtekst. 2) zoek de leverancier op btw-nummer of IBAN, niet op naam. 3) controleer op een dubbele post voordat je iets voorstelt. 4) zoek de inkooporder als er een referentie is. 5) stel grootboekrekening, btw-code en kostenplaats voor; kun je er niet één kiezen, laat het veld leeg en zeg dat. 6) elk bedrag komt uit de extractie of het pakket, nooit uit je eigen berekening. 7) noem expliciet wat je niet kon vaststellen.
- **`deviation_check`**: 1) haal factuur, inkooporder en ontvangst op. 2) vergelijk aantal, prijs en totaal, veld voor veld. 3) benoem het verschil in euro en in procent van het factuurbedrag. 4) bij een mogelijke dubbele post: noem het bestaande factuurnummer en de boekdatum. 5) stel blokkeren voor, nooit betalen. 6) geen oordeel over opzet of fraude, alleen het feitelijke verschil.
- **`receivables`**: 1) haal de openstaande post en de relatie op. 2) controleer eerst de bankmutaties op een betaling die nog niet is afgeletterd, voordat je iets over te laat betalen zegt. 3) bepaal de aanmaningstrap uit de historie, sla nooit een trap over. 4) toon bedragen uitsluitend na identificatie volgens §9. 5) bij een verzoek om uitstel: leg de afspraak vast als voorstel, beloof niets over rente of kosten. 6) toon nooit posten van een andere relatie.
- **`payables`**: 1) haal de openstaande crediteurpost en het banksaldo op. 2) bepaal vervaldatum en eventuele betalingskortingstermijn. 3) stel voor om klaar te zetten voor betaling, niet om te betalen. 4) meld het als het saldo de batch niet dekt. 5) geen betaling voorstellen bij een openstaande blokkade uit `deviation_check`.
- **`reconciliation`**: 1) haal de mutatie op. 2) zoek kandidaat-posten op bedrag, IBAN en omschrijving. 3) geef maximaal drie kandidaten met de reden per kandidaat. 4) bij één sluitende match: stel afletteren voor. 5) bij deelbetaling: stel niets voor en zet het als taak in de werkbak.
- **`vat_check`**: 1) haal de conceptaangifte en de grootboektotalen op. 2) vergelijk per rubriek. 3) noem elk verschil met bedrag en rubriek. 4) markeer verlegging en ICP apart. 5) geen fiscaal advies, alleen de constatering en de betreffende boekingen. 6) bij twijfel: naar de accountant.
- **`cashflow`**: 1) haal saldi, openstaande debiteuren en crediteuren op. 2) projecteer op vervaldata, gebruik geen aannames over betaalgedrag die niet uit de historie komen. 3) meld een verwacht tekort met datum en bedrag. 4) doe geen uitspraak over financierbaarheid.
- **`finance_escalate`**: geen tools, geen voorstel. Vat samen wat er speelt en waarom een mens het moet oppakken.

## 6. Feiten en MCP-tools

| toolnaam | doelsysteem | invoer | uitvoervelden | dataCategories | waarom nodig voor grounding |
|---|---|---|---|---|---|
| `doc.extract_invoice` | nieuw: mcp-doc | `fileId` | `supplierName`, `vatNumber`, `iban`, `invoiceNumber`, `invoiceDate`, `dueDate`, `netAmount`, `vatAmount`, `totalAmount`, `lines[]`, `poReference`, `confidencePerField` | financieel | elk bedrag in een boekingsvoorstel moet uit deze call komen, niet uit de mailtekst |
| `boekhouding.find_supplier` | Exact / AFAS / SnelStart / Moneybird / Twinfield / e-Boekhouden / Odoo / Yuki | `vatNumber` of `iban` | `relationId`, `name`, `paymentTerms`, `defaultLedger`, `blocked` | commercieel, financieel | koppelt de factuur aan een bestaande relatie; naam-matching is te onbetrouwbaar voor een betaling |
| `boekhouding.get_invoice` | idem | `invoiceNumber` | `invoiceId`, `type`, `status`, `totalAmount`, `openAmount`, `dueDate`, `relationId`, `vatCode` | financieel | dekt bedrag en status in elk voorstel dat geld raakt |
| `boekhouding.find_duplicate_invoice` | idem | `relationId`, `invoiceNumber`, `totalAmount`, `invoiceDate` | `matches[]{invoiceId, invoiceNumber, bookedAt, amount, matchReason}` | financieel | zonder deze call is "dit is een dubbele" een gok |
| `boekhouding.get_purchase_order` | idem | `poNumber` | `poNumber`, `supplierId`, `lines[]{sku, qty, unitPrice}`, `status` | operationeel, financieel | levert de referentiewaarden voor de afwijkingsvergelijking |
| `boekhouding.get_goods_receipt` | idem | `poNumber` | `receipts[]{sku, qtyReceived, receivedAt}` | operationeel | derde been van de driewegmatch |
| `boekhouding.list_open_items` | idem | `relationId?`, `overdueSince?` | `items[]{invoiceNumber, openAmount, dueDate, daysOverdue, dunningStage}` | financieel | voedt de dagelijkse cron en elke herinnering |
| `boekhouding.list_open_payables` | idem | `dueBefore` | `items[]{invoiceId, supplierId, openAmount, dueDate, discountUntil, blocked}` | financieel | basis voor de betaalbatch |
| `boekhouding.get_dunning_history` | idem | `relationId` | `steps[]{stage, sentAt, channel, amountAtTime}` | financieel, persoonsgegevens | voorkomt dat een trap wordt overgeslagen of herhaald |
| `boekhouding.get_relation` | idem | `relationId` | `name`, `contactEmail`, `contactName`, `paymentTerms`, `iban`, `isConsumer` | commercieel, persoonsgegevens | levert het adres waar een herinnering heen mag, en de vlag consument/zakelijk |
| `boekhouding.list_ledger_accounts` | idem | `query?` | `accounts[]{code, name, vatDefault}` | financieel | de agent kiest uit bestaande rekeningen, hij verzint er geen |
| `boekhouding.list_ledger_entries` | idem | `period`, `account?` | `entries[]{entryId, account, amount, vatCode, date}` | financieel | onderbouwing per rubriekverschil |
| `boekhouding.get_vat_return` | idem | `period` | `rubrieken{}`, `status`, `dueDate` | financieel | de conceptaangifte waartegen wordt vergeleken |
| `boekhouding.get_vat_codes` | idem | n.v.t. | `codes[]{code, rate, type}` | financieel | voorkomt een verzonnen btw-code in een boeking |
| `bank.list_transactions` | nieuw: mcp-bank (PSD2 / CAMT.053) | `iban`, `from`, `to` | `transactions[]{transactionId, amount, counterpartyIban, counterpartyName, description, valueDate, reconciled}` | financieel, persoonsgegevens | bewijst dat er wel of niet betaald is voordat er wordt aangemaand |
| `bank.get_balance` | idem | `iban` | `balance`, `currency`, `asOf` | financieel | dekt elke uitspraak over ruimte voor een betaalbatch |
| `mail.get_thread` | bestaand: mcp-mail | `messageId` | `thread[]` | operationeel, persoonsgegevens | context bij een crediteur- of factuurvraag |
| `tickets.create` | bestaand: mcp-tickets | `subject`, `description` | `ticketId`, `number` | operationeel | uitzoekwerk dat geen financiële actie is |

**Nieuw te bouwen MCP-servers:** `mcp-boekhouding` (adapterlaag met één schema en per pakket een adapter: Exact Online, AFAS, SnelStart, Moneybird, Twinfield, e-Boekhouden, Odoo, Yuki), `mcp-bank` (PSD2-aggregator plus CAMT.053-import), `mcp-doc` (PDF- en beeldextractie). De adapters bevatten geen AI. Beslissingen blijven in agent-core.

## 7. ReviewItem-kinds en proposed-vorm

Kinds die deze module produceert: `invoice_booking`, `payment_reminder`, `dunning_step`, `payment_batch`, `reconciliation_match`, `vat_report`, `credit_note`, `draft_email`, `task`.

```jsonc
// kind: "invoice_booking"
{
  "supplier": { "relationId": "REL-208", "name": "Bergsma Groothandel B.V." },
  "invoice":  { "number": "2026-04417", "date": "2026-08-11", "dueDate": "2026-09-10",
                "netAmount": 4820.00, "vatAmount": 1012.20, "totalAmount": 5832.20 },
  "booking":  { "ledgerAccount": "7000", "vatCode": "H21", "costCenter": "PROJ-114" },
  "match":    { "poNumber": "IO-2231", "status": "match" | "afwijking" | "geen_po",
                "differences": [{ "field": "lines.0.unitPrice", "po": 12.40, "invoice": 13.10 }] },
  "duplicateCheck": { "checked": true, "matches": [] },
  "classification": { "category": "inkoopfactuur", "confidence": 0.91, "specialist": "invoice_intake" },
  "extractionConfidence": { "totalAmount": 0.99, "vatAmount": 0.94, "poReference": 0.61 }
}

// kind: "payment_reminder" / "dunning_step"
{
  "relation": { "relationId": "REL-77", "name": "Koopman Transport B.V.",
                "contactEmail": "administratie@koopman-transport.example.com", "isConsumer": false },
  "items": [{ "invoiceNumber": "VF-2026-0912", "openAmount": 3410.00,
              "dueDate": "2026-07-14", "daysOverdue": 36 }],
  "totalOpen": 3410.00,
  "dunning": { "stage": 2, "previousStage": 1, "previousSentAt": "2026-07-28" },
  "paymentCheck": { "bankChecked": true, "matchingTransactions": [] },
  "subject": "Herinnering openstaande factuur VF-2026-0912",
  "body": "…",
  "classification": { "category": "openstaande_post", "confidence": 0.88, "specialist": "receivables" }
}

// kind: "vat_report"
{
  "period": "2026-Q2",
  "differences": [{ "rubriek": "1a", "aangifte": 41220.00, "grootboek": 41905.50,
                    "verschil": 685.50, "entries": ["JE-8812", "JE-8830"] }],
  "icp": { "count": 3, "total": 12400.00 },
  "documentUrl": "…",
  "classification": { "category": "btw_controle", "confidence": 0.93, "specialist": "vat_check" }
}
```

`toCard`-viewmodel per kind:

| kind | title | subtitle | badges |
|---|---|---|---|
| `invoice_booking` | `"Factuur {invoice.number}, € {totalAmount}"` | leveranciernaam | categorie, `match`-status (tone `alert` bij afwijking), `"dubbel?"` bij matches, specialist |
| `payment_reminder` | `"Herinnering, € {totalOpen}"` | relatienaam | categorie, `"trap {stage}"`, `"{daysOverdue} dagen"` (tone `alert` boven 30) |
| `dunning_step` | `"Aanmaning trap {stage}, € {totalOpen}"` | relatienaam | `"trap {stage}"` tone `alert`, `"consument"` bij `isConsumer` |
| `payment_batch` | `"Betaalbatch {date}, € {total}"` | `"{count} facturen"` | `"saldo dekt"` / `"saldo ontoereikend"` tone `alert` |
| `reconciliation_match` | `"Mutatie € {amount} koppelen"` | tegenpartijnaam | `"{n} kandidaten"`, zekerheid |
| `vat_report` | `"Btw-controle {period}"` | `"{n} verschillen"` | `"€ {grootste verschil}"` tone `alert` |
| `credit_note` | `"Creditnota € {amount}"` | relatienaam | `"boven drempel"` bij `amount > amountThreshold` |

`detailHref`: `/administratie/{id}`. Icoon: `Receipt`. `order: 30`.

## 8. Actietypen

Toevoegen aan `ACTION_TYPES`. Kanalen staan bewust smal: `schedule` en `doc` zijn nieuwe `ChannelId`-waarden voor triggers zonder afzender.

| type-slug | target {mcp, tool} | preconditionKind | impact | approverRole | amountThreshold | expiresAfterMinutes | payloadFields |
|---|---|---|---|---|---|---|---|
| `factuur_boeken` | `boekhouding` / `book_purchase_invoice` | `factuurstatus` | Boekt de inkoopfactuur in het pakket | reviewer | 5000 | 7 dagen (10080) | `invoiceNumber`, `supplierId`, `totalAmount` (editable), `vatAmount` (editable), `ledgerAccount` (editable), `vatCode` (editable), `costCenter` (editable) |
| `factuur_blokkeren` | `boekhouding` / `block_invoice` | `factuurstatus` | Zet de factuur op blokkade zodat er niet betaald wordt | reviewer | n.v.t. | 30 dagen (43200) | `invoiceNumber`, `reason` (bericht, editable) |
| `herinnering_versturen` | `mail` / `send_mail` | `openstaande_post` | Stuurt een betalingsherinnering naar de relatie | reviewer | n.v.t. | 24 uur (1440) | `relationId`, `toEmail`, `subject` (editable), `body` (editable), `invoiceNumbers`, `totalOpen` |
| `aanmaning_versturen` | `mail` / `send_mail` | `openstaande_post` | Stuurt een formele aanmaning en verhoogt de aanmaningstrap | reviewer | 2500 | 24 uur (1440) | `relationId`, `toEmail`, `stage`, `subject` (editable), `body` (editable), `totalOpen` |
| `incasso_overdragen` | `boekhouding` / `handover_collection` | `openstaande_post` | Draagt de vordering over aan het incassotraject | **admin** | 0 (altijd admin) | 24 uur (1440) | `relationId`, `invoiceNumbers`, `totalOpen`, `reason` (bericht, editable) |
| `betaalafspraak_vastleggen` | `boekhouding` / `create_payment_arrangement` | `openstaande_post` | Legt een betalingsregeling vast en pauzeert de aanmaningen | reviewer | 5000 | 7 dagen | `relationId`, `invoiceNumbers`, `installments[].amount` (editable), `installments[].dueDate` (editable) |
| `betaling_klaarzetten` | `boekhouding` / `queue_payment` | `factuurstatus` | Zet de factuur klaar in de betaalbatch. Vrijgeven bij de bank blijft mensenwerk | **admin** | 0 (altijd admin) | 12 uur (720) | `invoiceId`, `supplierIban`, `amount`, `paymentDate` (editable) |
| `creditnota_finance_voorstellen` | `boekhouding` / `create_credit_note` | `factuurstatus` | Maakt een creditnota aan op een verkoopfactuur | **admin** | 0 (altijd admin) | 24 uur (1440) | `invoiceNumber`, `amount` (editable), `reason` (bericht, editable) |
| `mutatie_afletteren` | `boekhouding` / `reconcile_transaction` | `betaalstatus` | Koppelt een bankmutatie aan een openstaande post | reviewer | n.v.t. | 7 dagen | `transactionId`, `invoiceNumber`, `amount` |
| `boekingsregel_corrigeren` | `boekhouding` / `update_ledger_entry` | `factuurstatus` | Past grootboekrekening of btw-code van een geboekte regel aan | **admin** | n.v.t. | 7 dagen | `entryId`, `ledgerAccount` (editable), `vatCode` (editable), `reason` (bericht, editable) |
| `werkticket_aanmaken` | bestaand | `geen` | Uitzoekwerk zonder financiële mutatie | reviewer | n.v.t. | 7 dagen | bestaand |

Wat een mens **altijd** ziet: elk bedrag, elke uitgaande betaling, elke creditnota, elke incasso-overdracht en elke correctie op een geboekte regel. Geen enkel type in dit domein krijgt auto-approve, ook niet bij hoge zekerheid.

`PRECONDITION_KINDS` uitbreiden met `openstaande_post` (`PRECONDITION_FIELDS`: `invoiceNumber`, `openAmount`, `dunningStage`) en `betaalstatus` (`transactionId`, `reconciled`, `amount`). `DataCategory` in `packages/agent-core/src/access/grants.ts` uitbreiden met `persoonsgegevens` en `bijzonder`; de bestaande drie blijven ongewijzigd.

## 9. Uitkomsten en identificatie

| Uitkomst | Wanneer |
|---|---|
| `kennis` | vraag over betaaltermijn, btw-nummer, factuuradres of het aanmaningsbeleid. Uit de kennisbasis, geen bedragen |
| `systeem` | een concreet feit uit het pakket: is deze factuur betaald, wat is het openstaande bedrag. Alleen bij voldoende identificatie én een geslaagde lookup |
| `taak` | alles wat een schrijfoperatie voorstelt: boeken, aanmanen, afletteren, betalen, crediteren |
| `onbekend` | geen relatie of factuur te herleiden. De agent vraagt door, hij maakt geen ticket |

Identificatie-eisen, strenger dan bij klantenservice:

| Situatie | Vereist niveau |
|---|---|
| algemene betaaltermijn of btw-nummer noemen | `zwak` |
| openstaand bedrag of factuurstatus **tonen** | `gematcht`: afzenderadres komt overeen met `contactEmail` van de relatie én het factuurnummer is teruggevonden |
| kopie van een factuur versturen | `gematcht`, en uitsluitend naar het adres uit het pakket, nooit naar het adres uit de mail |
| bankrekening of IBAN wijzigen | niet geautomatiseerd, in geen enkele vorm |
| betaalafspraak of creditnota voorstellen | `gematcht` plus admin-goedkeuring |

Cron- en webhookgedreven signalen hebben geen afzender. Daar geldt: de identificatie is systeemzijdig (`relationId` uit het pakket) en het adres waarnaar iets gaat komt **altijd** uit `boekhouding.get_relation`, nooit uit een binnengekomen bericht. Dat sluit factuurfraude via een gespoofde mail af bij de bron.

## 10. Schermen en tabellen

Nav-items op de module: `/administratie/facturen` (inkoopstroom en boekingsvoorstellen), `/administratie/openstaand` (debiteuren met aanmaningstrap), `/administratie/betalingen` (betaalbatch en aflettering), `/administratie/btw` (aangiftecontrole). Werkbak-tab komt via de registry.

Nieuwe tabellen:

| tabel | kolommen | indexen |
|---|---|---|
| `aios_fin_documents` | `id` pk, `organization_id`, `source` (`mail`\|`upload`\|`webhook`), `file_path`, `filename`, `content_type`, `pages`, `extracted` jsonb, `extraction_confidence` jsonb, `signal_id` fk, `review_item_id` fk, `created_at` | `(organization_id, created_at desc)`, `(signal_id)` |
| `aios_fin_open_items` | `id` pk, `organization_id`, `relation_id`, `invoice_number`, `direction` (`debiteur`\|`crediteur`), `total_amount` numeric(14,2), `open_amount` numeric(14,2), `due_date` date, `dunning_stage` int default 0, `arrangement_id` fk null, `blocked` bool default false, `synced_at` | `(organization_id, direction, due_date)`, uniek `(organization_id, invoice_number, direction)`, `(organization_id, relation_id)` |
| `aios_fin_dunning_log` | `id` pk, `organization_id`, `relation_id`, `invoice_number`, `stage` int, `channel`, `sent_at`, `review_item_id` fk, `amount_at_time` numeric(14,2) | `(organization_id, relation_id, sent_at desc)` |
| `aios_fin_arrangements` | `id` pk, `organization_id`, `relation_id`, `status` (`ACTIVE`\|`COMPLETED`\|`BROKEN`), `installments` jsonb, `created_by`, `created_at` | `(organization_id, relation_id, status)` |
| `aios_fin_anomalies` | `id` pk, `organization_id`, `kind` (`dubbel`\|`prijsafwijking`\|`aantalafwijking`\|`geen_po`\|`iban_gewijzigd`), `invoice_number`, `reference_invoice_number`, `delta_amount` numeric(14,2), `detail` jsonb, `status` (`OPEN`\|`AFGEHANDELD`\|`GENEGEERD`), `created_at` | `(organization_id, status, created_at desc)` |
| `aios_fin_vat_checks` | `id` pk, `organization_id`, `period`, `differences` jsonb, `total_difference` numeric(14,2), `review_item_id` fk, `created_at` | uniek `(organization_id, period)` |

Bestaande tabellen die een `module`-kolom nodig hebben of al hebben: `aios_review_items` (heeft het, migratie 0030), `aios_proposed_actions` (toevoegen: `module text`), `aios_tickets` (toevoegen), `aios_decision_logs` (toevoegen), `aios_policy_rules` (toevoegen, want "facturatie" betekent iets anders per module), `aios_memory_entries` (toevoegen, zodat een SOP van administratie niet in de klantenservice-retrieval terechtkomt). RLS per tenant blijft ongewijzigd.

## 11. Demo-scenario's

1. **Inkoopfactuur met inkooporder.** PDF van `facturen@bergsma-groothandel.example.com`, factuur 2026-04417, € 5.832,20 incl. btw, referentie IO-2231. Driewegmatch klopt. Voorstel `factuur_boeken` op grootboek 7000, btw H21. Eén klik.
2. **Prijsafwijking.** Van Dijk Installatietechniek B.V. factureert € 13,10 per stuk tegen € 12,40 op de inkooporder, 340 stuks, verschil € 238,00. Voorstel `factuur_blokkeren` met de regelvergelijking in de kaart. Boeken kan niet zolang de blokkade openstaat.
3. **Dubbele factuur.** Meijer Interieurbouw stuurt factuur 8841 opnieuw, twee weken na de eerste. `find_duplicate_invoice` geeft de reeds geboekte post van 4 augustus terug. Geen boekingsvoorstel, wel een rij in `aios_fin_anomalies` en een concept-mail naar de leverancier.
4. **Aanmaning trap 2.** Koopman Transport B.V., factuur VF-2026-0912, € 3.410,00, 36 dagen over de vervaldatum. De agent controleert eerst de bankmutaties, vindt niets, leest trap 1 uit de historie en stelt `aanmaning_versturen` trap 2 voor naar `administratie@koopman-transport.example.com`.
5. **Betaalbewijs dat wel klopt.** Novaform Kunststoffen mailt een betaalbewijs voor VF-2026-0880. `bank.list_transactions` toont een ontvangst van € 1.244,50 op 12 augustus die nog niet is afgeletterd. Uitkomst: `mutatie_afletteren`, en het aanmaningstraject stopt. Dit is het scenario dat laat zien waarom de agent eerst de bank raadpleegt.
6. **Deelbetaling die niet sluit.** De Waal Bouw betaalt € 2.000,00 op een openstaande post van € 3.150,00 zonder referentie. Twee kandidaten met bijna hetzelfde bedrag. De agent stelt niets voor, zet een taak in de werkbak en noemt beide kandidaten met de reden.
7. **Escalatie: gewijzigd rekeningnummer.** Mail die eruitziet als afkomstig van Bergsma Groothandel met de mededeling dat het IBAN is gewijzigd, met een factuur als bijlage. De IBAN in de bijlage wijkt af van het IBAN bij de relatie. De agent stelt geen boeking en geen betaling voor, legt een `aios_fin_anomalies`-rij aan met `kind = iban_gewijzigd` en escaleert naar een mens met de reden. Dit is een bewuste harde escalatie, geen voorstel.
8. **Btw-controle Q2.** Rubriek 1a wijkt € 685,50 af tussen conceptaangifte en grootboek, terug te voeren op twee journaalposten. Voorstel `vat_report` met de twee posten erbij, plus de aanbeveling om het met de accountant af te stemmen. Geen fiscaal oordeel.

## 12. Analytics en waarde

| KPI | Bron |
|---|---|
| Openstaand debiteurensaldo en verdeling over 0-30, 30-60, 60-90, 90+ dagen | `aios_fin_open_items` |
| DSO, gemiddeld aantal dagen tussen factuurdatum en betaling | `aios_fin_open_items` plus bankmutaties |
| Aantal facturen per week door de intake, en het aandeel dat ongewijzigd is goedgekeurd | `aios_review_items` gefilterd op `kind = invoice_booking` |
| Correctiegraad: aandeel voorstellen waarin een reviewer een veld aanpaste | `aios_action_edits` |
| Gedetecteerde afwijkingen per soort en het bedrag dat erin omging | `aios_fin_anomalies` |
| Aanmaningen per trap en het bedrag dat na elke trap binnenkwam | `aios_fin_dunning_log` |
| Aantal openstaande crediteurposten binnen de kortingstermijn | `boekhouding.list_open_payables` |
| Doorlooptijd van voorstel tot besluit, per kind | `aios_review_items` |

Geen KPI over bespaarde uren zolang er geen nulmeting bij de klant ligt.

## 13. Risico's en grenzen

**Altijd een mens:** elk bedrag dat naar buiten gaat, elke betaling, elke creditnota, elke incasso-overdracht, elke correctie op een geboekte regel, en elk geval waarin het IBAN van een leverancier afwijkt van wat er in het pakket staat.

**AVG.** Openstaande posten van eenmanszaken en consumenten zijn persoonsgegevens. Betaalachterstand is gevoelige informatie over een persoon, ook al is het geen bijzondere categorie in de zin van artikel 9. Concreet: `dataCategories` op deze tools staat op `persoonsgegevens` waar dat speelt, aanmaningshistorie valt onder de compliance-bewaartermijn van 365 dagen, en bedragen worden alleen getoond na identificatie volgens §9. Bankomschrijvingen kunnen bijzondere gegevens bevatten (een betaling aan een zorgverlener); die worden niet in de LLM-context gezet bij `reconciliation`, alleen bedrag, IBAN en referentie.

**EU AI Act.** De meeste stappen in deze module zijn beperkt risico met transparantieplicht. Eén grens is hard: **kredietwaardigheidsbeoordeling van natuurlijke personen is hoog-risico onder Annex III van de AI Act.** Deze module doet daarom geen kredietscoring, geen betaalgedragsvoorspelling per persoon, en geen classificatie die bepaalt of iemand nog mag kopen of leveren op krediet. Wat de module wel doet is feiten tonen die al in het pakket staan: openstaand bedrag, vervaldatum, aanmaningstrap. Zodra een klant vraagt om "een scoretje per debiteur" gaat dat naar Sjaak, niet naar de backlog.

**Bewust niet geautomatiseerd:** betalingen daadwerkelijk vrijgeven bij de bank, IBAN-wijzigingen doorvoeren, de btw-aangifte indienen, jaarrekeningposten, afboeken van oninbare vorderingen, en elke vorm van fiscaal advies. De agent stelt voor, hij tekent niet.

## 14. Bouwvolgorde

**V1, de kleinste demonstreerbare versie.** `mcp-boekhouding` met één adapter (Moneybird of Exact Online, afhankelijk van de eerste klant), `mcp-doc` met `extract_invoice`, de specialist `invoice_intake`, kind `invoice_booking`, actietype `factuur_boeken`, tabel `aios_fin_documents`, scherm `/administratie/facturen`. Trigger: PDF-upload plus mailbijlage. Eén demo: factuur binnen, boekingsvoorstel klaar, mens keurt goed, post staat in het pakket.

**V2.** Dagelijkse cron op openstaande posten, specialist `receivables`, kinds `payment_reminder` en `dunning_step`, tabellen `aios_fin_open_items` en `aios_fin_dunning_log`, scherm `/administratie/openstaand`. Hiervoor is `mcp-bank` nodig, want zonder betaalcontrole hoort er geen herinnering de deur uit.

**V3.** `deviation_check` met driewegmatch en dubbeldetectie, tabel `aios_fin_anomalies`, actietype `factuur_blokkeren`. Dit is het onderdeel dat het meeste indruk maakt in een demo.

**V4.** `reconciliation` en `payables`, scherm `/administratie/betalingen`, actietypen `mutatie_afletteren` en `betaling_klaarzetten`.

**V5.** `vat_check` en `cashflow`, scherm `/administratie/btw`, PDF-uitvoer via de bestaande documentketen. Daarna extra pakketadapters, één per klant, zonder wijziging in agent-core.

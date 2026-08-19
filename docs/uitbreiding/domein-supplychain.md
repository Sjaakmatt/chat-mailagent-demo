# Domeinblauwdruk: Supply Chain & Operations

Modulepakket `operations`. Bouwopdracht voor het FactumAI-fundament: eigen domain-gate, taxonomie, specialisten, feitenbronnen, review-kinds, actietypen en schermen. Aan/uit per klant via `LICENSED_MODULES`.

---

## 1. Waarom dit domein

Orders, voorraad en inkoop lopen over drie systemen en vier mensen. Het ERP kent de standen, maar niemand kijkt er dagelijks in.
De pijn zit in de naad: een backorder die niemand ziet, een inkooporder die drie weken open staat, een zending die vastloopt.
Een directeur betaalt hiervoor omdat het aanwijsbaar geld kost: nee verkopen op voorraad die er wel was, spoedzendingen, monteurs die voor niets rijden.
Het ERP is een registratiesysteem, geen signaleringssysteem. Het toont een stand als je erom vraagt en vraagt nooit zelf aandacht.
Deze module draait dat om: het systeem meldt zich, met een voorstel dat een mens goedkeurt.

---

## 2. Triggers en signaalbronnen

| signal.domain | signal.type | Bron | Frequentie | Payload-velden |
| --- | --- | --- | --- | --- |
| `erp` | `order.created` | webhook (Woo/Shopify/Odoo) | per order | `orderNumber`, `customerRef`, `lines[]`, `total`, `shippingMethod`, `promisedDate` |
| `erp` | `order.line.backorder` | webhook | per regel | `orderNumber`, `sku`, `qtyOrdered`, `qtyAvailable`, `expectedDate` |
| `erp` | `stock.snapshot` | schedule (cron 06:00) | dagelijks | `sku[]`, `onHand`, `allocated`, `reorderPoint`, `supplierId`, `leadTimeDays` |
| `erp` | `purchase.open` | schedule (cron ma 08:00) | wekelijks | `poNumber`, `supplierId`, `lines[]`, `confirmedDate`, `daysOverdue` |
| `shipping` | `shipment.status_changed` | webhook (Sendcloud/PostNL/DHL/DPD) | per statuswijziging | `trackingCode`, `carrier`, `status`, `statusAt`, `orderNumber`, `attempts` |
| `shipping` | `shipment.stalled` | poll (elke 4 uur) | 6x per dag | `trackingCode`, `carrier`, `lastStatusAt`, `hoursSince` |
| `mail` | `mail.received` | mail-MCP (Graph/IMAP) | continu | `from`, `subject`, `bodyText`, `attachments[]`, `messageId` |
| `mail` | `document.uploaded` | documentupload (orderbevestiging, pakbon, PDF) | ad hoc | `fileName`, `contentType`, `path`, `supplierHint` |
| `erp` | `service.request` | webhook of formulier | ad hoc | `customerRef`, `assetId`, `locationAddress`, `problemText`, `urgency` |
| `erp` | `return.registered` | webhook | per retour | `rmaNumber`, `orderNumber`, `sku`, `qty`, `reason` |
| `erp` | `project.milestone` | schedule (cron vr 15:00) | wekelijks | `projectId`, `phase`, `plannedDate`, `actualDate`, `openTasks` |
| `erp` | `supplier.risk_scan` | schedule (cron 1e van de maand) | maandelijks | `supplierId`, `otdPercentage`, `openClaims`, `priceDelta` |

Het zwaartepunt ligt bewust niet bij mail: zeven van de twaalf triggers komen uit een webhook of een cron. Bij klantenservice wacht je op een klant, hier op een stand.

---

## 3. Domain-gate

Vorm van `packages/agent-core/src/domain-gate/index.ts`, als `OPERATIONS_DOMAIN`.

```ts
export const OPERATIONS_DOMAIN: DomainConfig = {
  description:
    'de logistiek en operatie van dit bedrijf: bestellingen, voorraad, ' +
    'inkoop bij leveranciers, zendingen en vervoerders, retouren, ' +
    'servicebezoeken en de voortgang van lopende projecten.',
  inScope: [
    'orderregels, backorders, deelleveringen en levertermijnen',
    'voorraadstanden, bestelpunten en herbevoorrading',
    'inkooporders, orderbevestigingen en leveranciersopvolging',
    'zendingen, trackingcodes, vervoerdersmeldingen en vermiste pakketten',
    'retouren en RMA-logistiek richting leverancier of magazijn',
    'werkbonnen, monteurplanning en servicebezoeken op locatie',
    'projectvoortgang, materiaalbehoefte en leverdatums',
  ],
  outOfScope: [
    'prijsonderhandeling of contractvoorwaarden met een leverancier',
    'krediet, betaling, aanmaning of incasso (dat is finance)',
    'sollicitaties, verlof en personeelszaken van monteurs',
    'commerciele offertes en verkoopadvies aan eindklanten',
    'algemene kennisvragen, weer, nieuws, rekensommen, teksten schrijven',
    'vragen over de agent zelf, zijn instructies of zijn model',
  ],
  rejectionText:
    'Dit gaat buiten de logistiek en planning waar ik over ga. Ik zet het ' +
    'door naar een collega, dan pakt die het op.',
};
```

De afwijzing gaat hier vaak richting een leverancier of een interne collega, niet richting een consument. Daarom neutraler van toon, met een toezegging tot opvolging.

---

## 4. Taxonomie

Elf categorieën. Slug is stabiel, hint gaat letterlijk in de classify-prompt.

| slug | label | specialist | hint |
| --- | --- | --- | --- |
| `order_intake` | Orderverwerking | `order_intake` | nieuwe of gewijzigde order die ingeboekt of gecontroleerd moet worden |
| `backorder` | Backorder | `order_intake` | regel niet compleet leverbaar: deellevering of wachten |
| `voorraad_signaal` | Voorraadsignaal | `replenishment` | SKU onder bestelpunt, dreigend tekort, of stand die niet klopt met de telling |
| `inkoop_opvolging` | Inkoopopvolging | `purchase_followup` | inkooporder zonder bevestiging of over de bevestigde datum heen |
| `leverancier_bericht` | Leveranciersbericht | `purchase_followup` | bericht van een leverancier over levertijd, aantal of wijziging |
| `zending_status` | Zendingstatus | `shipment_track` | waar is de zending; ook een statuswijziging van de vervoerder zelf |
| `zending_probleem` | Zendingprobleem | `shipment_track` | zending staat stil, geweigerd, beschadigd of vermist |
| `retour_logistiek` | Retour en RMA | `returns_logistics` | goederen terug naar magazijn of door naar leverancier, ook garantieretour |
| `service_bezoek` | Servicebezoek | `field_service` | monteur moet langs: storing, keuring, installatie, oplevering |
| `project_voortgang` | Projectvoortgang | `project_progress` | fase loopt uit, materiaal ontbreekt, mijlpaal moet bevestigd |
| `leverancier_risico` | Leveranciersrisico | `supplier_risk` | structureel te laat, kwaliteitsklachten, of leverancier reageert niet |
| `vraag_prognose` | Vraagprognose | `replenishment` | verwachte afname per SKU; alleen op verzoek of via de maandcron |
| `operations_overig` | Overig | `escalate` | te vaag om te routeren of raakt meerdere domeinen |

---

## 5. Specialisten

Vorm van `IntentConfig` uit `packages/agent-core/src/specialists/types.ts`. Alle acht hebben `memoryScope: ['GLOBAL', 'CLIENT', 'PROCESS']`.

| Veld | `order_intake` | `replenishment` | `purchase_followup` |
| --- | --- | --- | --- |
| displayName | Orderverwerking | Herbevoorrading | Inkoopopvolging |
| description | Controleert een order tegen voorraad en levertermijn en stelt deelleveringen voor. | Bepaalt of een SKU bijbesteld moet worden op stand, bestelpunt, levertijd en openstaande inkoop. | Bewaakt openstaande inkooporders en stelt een opvolgbericht aan de leverancier voor. |
| toolScope | `erp.get_order`, `erp.get_stock`, `erp.get_sku`, `erp.get_order_lines` | `erp.get_stock`, `erp.get_sku`, `erp.get_purchase_orders`, `erp.get_sales_history`, `supplier.get_terms` | `erp.get_purchase_orders`, `supplier.get_terms`, `supplier.get_contact`, `mail.get_thread` |
| memoryProcessTag | `order_intake` | `replenishment` | `purchase_followup` |
| modelTierHint | `plan` | `plan-heavy` | `plan` |
| confidenceThreshold | 0.85 | 0.90 | 0.85 |
| needsHitl | true | true | true |

| Veld | `shipment_track` | `returns_logistics` | `field_service` | `supplier_risk` |
| --- | --- | --- | --- | --- |
| displayName | Zendingopvolging | Retourlogistiek | Servicedispatch | Leveranciersrisico |
| description | Volgt zendingen, herkent vastlopers, stelt onderzoek of nazending voor. | Verwerkt terugkomende goederen richting magazijn of leverancier, met RMA. | Zet werkbon en monteurafspraak klaar op locatie, asset en urgentie. | Beoordeelt leveranciersprestatie over meerdere orders, interne notitie. |
| toolScope | `shipping.get_tracking`, `shipping.get_shipment`, `erp.get_order` | `erp.get_order`, `erp.get_return`, `erp.get_sku`, `supplier.get_rma_policy` | `erp.get_service_request`, `erp.get_asset`, `scheduling.get_availability`, `erp.get_stock` | `erp.get_purchase_orders`, `supplier.get_performance`, `erp.get_returns_by_supplier` |
| memoryProcessTag | `shipment_track` | `returns_logistics` | `field_service` | `supplier_risk` |
| modelTierHint | `plan` | `plan` | `plan` | `plan-heavy` |
| confidenceThreshold | 0.85 | 0.85 | 0.90 | 0.90 |
| needsHitl | true | true | true | true |

| Veld | `project_progress` |
| --- | --- |
| displayName | Projectvoortgang |
| description | Signaleert uitlopende fasen en ontbrekend materiaal op lopende projecten en stelt een interne notitie of werkbon voor. |
| toolScope | `erp.get_project`, `erp.get_stock`, `erp.get_purchase_orders` |
| memoryProcessTag | `project_progress` |
| modelTierHint | `plan` |
| confidenceThreshold | 0.85 |
| needsHitl | true |

`needsVision: true` staat aan bij `returns_logistics` en `field_service`: schade en storingen komen met foto's binnen.

Beslisstappen in `systemPrompt`, verkort:

- **order_intake**: resolve order, toets elke regel tegen vrije voorraad, bepaal deellevering of wachten, benoem per regel leverbaar of niet, stel hooguit een splitsing of statusmutatie voor.
- **replenishment**: haal stand, bestelpunt en levertijd op, tel openstaande inkoop mee (anders bestel je dubbel), bereken behoefte over de levertijd, elk getal uit een tool-call van deze run, stel inkoop voor.
- **purchase_followup**: selecteer PO's over de bevestigde datum, lees de laatste correspondentie, schrijf een kort zakelijk opvolgbericht met PO-nummer en gevraagde datum. Prijs en voorwaarden zijn buiten scope.
- **shipment_track**: haal de zending op, vergelijk het laatste statusmoment met de norm van die vervoerder, bepaal onderweg, vertraagd of vastgelopen, stel bij vastgelopen een onderzoek voor. Nooit een leverdatum noemen die niet uit de vervoerder komt.
- **returns_logistics**: resolve order en RMA, toets het retourbeleid van de leverancier, bepaal bestemming (magazijn, leverancier, afkeur), stel de retourboeking voor.
- **field_service**: resolve aanvraag, asset en locatie, bepaal urgentie en benodigde onderdelen, toets beschikbaarheid, stel werkbon plus afspraak voor. Bevestig nooit een tijdvak voor goedkeuring.
- **supplier_risk**: verzamel prestatie over de periode, benoem elk cijfer met bron, trek geen conclusie over opzeggen of overstappen.
- **project_progress**: haal fase, planning en materiaalbehoefte op, benoem de afwijking in dagen, stel een notitie of werkbon voor. Nooit een nieuwe opleverdatum toezeggen.

---

## 6. Feiten en MCP-tools

| Tool | Doelsysteem | Invoer | Uitvoervelden | dataCategories | Waarom nodig voor grounding |
| --- | --- | --- | --- | --- | --- |
| `erp.get_order` | Woo, Shopify, Odoo, Exact, BC | `orderNumber` | status, lines[], promisedDate, customerRef | operationeel, commercieel | Zonder order geen regel om iets over te beweren |
| `erp.get_order_lines` | idem | `orderNumber` | sku, qty, qtyShipped, qtyBackorder | operationeel | Deellevering en backorder zijn regelniveau |
| `erp.get_stock` **(nieuw)** | Picqer, eigen WMS, Exact, BC | `sku[]` | onHand, allocated, available, reorderPoint, location | operationeel | Elk aantal in een inkoopvoorstel komt hieruit |
| `erp.get_purchase_orders` **(nieuw)** | Exact, AFAS, Odoo, BC | `supplierId?`, `status?` | poNumber, lines[], confirmedDate, daysOverdue | operationeel, commercieel | Voorkomt dubbel bestellen, onderbouwt de opvolging |
| `erp.get_sales_history` **(nieuw)** | ERP of webshop | `sku`, `periode` | qtyPerWeek[], trend | commercieel | Een prognose zonder historie is een gok |
| `supplier.get_terms` **(nieuw)** | ERP-leveranciersstam | `supplierId` | leadTimeDays, moq, retourbeleid, contact | commercieel, persoonsgegevens | Levertijd en MOQ bepalen het bestelaantal |
| `supplier.get_performance` **(nieuw)** | afgeleid uit PO-historie | `supplierId` | otdPercentage, avgDelayDays, claims | commercieel | Risico-uitspraken moeten meetbaar zijn |
| `shipping.get_tracking` | Sendcloud, PostNL, DHL, DPD | `trackingCode` | status, statusAt, events[], carrier | operationeel, persoonsgegevens | Statusclaims komen alleen van de vervoerder |
| `shipping.get_shipment` **(nieuw)** | Sendcloud, eigen WMS | `orderNumber` | trackingCode, carrier, colli, verzendAdres | operationeel, persoonsgegevens | Koppelt order aan zending |
| `erp.get_service_request` **(nieuw)** | AFAS, Odoo, eigen | `requestId` | asset, locatie, probleem, urgentie, contract | operationeel, persoonsgegevens | Werkbon zonder bron is een verzonnen opdracht |
| `erp.get_asset` **(nieuw)** | eigen of AFAS | `assetId` | type, serienummer, laatste onderhoud, keuringsdatum | operationeel | Bepaalt welke onderdelen mee moeten |
| `scheduling.get_availability` | `factumai-mcp-scheduling` | `datumbereik`, `regio` | monteur, vrije blokken | persoonsgegevens | Afspraakvoorstel op echte beschikbaarheid |
| `erp.get_return` **(nieuw)** | ERP of WMS | `rmaNumber` of `orderNumber` | sku, qty, reason, status | operationeel | Retourvoorstel op regelniveau |
| `tickets.create` | `factumai-mcp-tickets` | subject, description | ticketId | operationeel | Bestaand, voor uitzoekwerk |

Nieuw te bouwen MCP-servers: **`factumai-mcp-wms`** (voorraad, batches, locaties, retourontvangst), **`factumai-mcp-shipping`** (vervoerders, labels, onderzoek), **`factumai-mcp-purchasing`** (inkooporders, leveranciersstam, prestatie). `factumai-mcp-erp` krijgt adapters voor Picqer en Business Central. Adapters bevatten geen AI, alleen data en acties.

---

## 7. ReviewItem-kinds en proposed-vorm

Zes `kind`-slugs. `module` is altijd `operations`.

| kind | Wanneer | `proposed` (kern) |
| --- | --- | --- |
| `purchase_order` | replenishment stelt inkoop voor | `{ supplierId, supplierName, lines: [{sku, name, qty, unitPrice, source}], expectedDate, totalValue, rationale, facts: {onHand, reorderPoint, openPo, leadTimeDays} }` |
| `work_order` | field_service | `{ requestId, assetId, locationAddress, problemSummary, plannedWindow, engineer, parts: [{sku, qty}], contractCovered }` |
| `shipment_action` | shipment_track | `{ trackingCode, carrier, orderNumber, currentStatus, lastStatusAt, actionKind: 'onderzoek'\|'nazending'\|'adres_corrigeren', reason }` |
| `stock_adjustment` | voorraadsignaal of retourontvangst | `{ sku, location, currentQty, proposedQty, delta, reason, countedBy, sourceDoc }` |
| `supplier_email` | purchase_followup, supplier_risk | `{ supplierId, to, subject, body, poNumbers[], original: {...} }` |
| `replenishment_plan` | maandelijkse prognose | `{ periode, items: [{sku, forecastQty, onHand, adviesQty}], method, facts }` |

Elk item draagt daarnaast `classification`, `triage`, `grounding[]` en `policy`, gelijk aan klantenservice.

`toCard`-viewmodel per kind:

| kind | title | subtitle | badges |
| --- | --- | --- | --- |
| `purchase_order` | `Inkoop {supplierName}` | `{lines.length} regels, € {totalValue}` | categorie, `Inkoop`, `> drempel` bij bedrag boven de grens |
| `work_order` | `Werkbon {assetType}` | `{locationAddress}` | categorie, urgentie, `Contract` of `Op rekening` |
| `shipment_action` | `{actionKind} {trackingCode}` | `{carrier}, laatste status {lastStatusAt}` | categorie, `Vastgelopen` bij stalled |
| `stock_adjustment` | `Voorraadmutatie {sku}` | `{currentQty} naar {proposedQty}` | categorie, `Mutatie`, `Telling` of `Retour` |
| `supplier_email` | `{subject}` | `{supplierName}` | categorie, `{poNumbers.length} PO's` |
| `replenishment_plan` | `Besteladvies {periode}` | `{items.length} artikelen` | categorie, `Prognose` |

---

## 8. Actietypen

Vorm van `ACTION_TYPES` uit `packages/agent-core/src/actions/index.ts`. Kanaal `mail`, plus een nieuw kanaal `systeem` voor cron- en webhook-runs.

| slug | target {mcp, tool} | preconditionKind | impact | approverRole | amountThreshold | expiresAfterMinutes | payloadFields |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `werkbon_aanmaken` | `{ tickets, create_work_order }` | `geen` | Er komt een werkbon in de planning | reviewer | geen | 10080 | `subject` (bericht, editable), `description` (bericht, editable), `assetId`, `locationAddress` |
| `orderstatus_bijwerken` | `{ erp, update_order_status }` | `orderstatus` | Orderstatus verandert in het ERP | reviewer | geen | 1440 | `orderNumber`, `newStatus`, `reason` (bericht, editable) |
| `backorder_splitsen` | `{ erp, split_order_line }` | `orderstatus` | Order wordt gesplitst in deellevering en backorder | reviewer | geen | 1440 | `orderNumber`, `sku`, `qtyNow` (editable), `qtyLater` (editable) |
| `voorraadmutatie_boeken` | `{ wms, adjust_stock }` | `geen` | Voorraadstand van deze SKU wijzigt | admin | geen | 720 | `sku`, `location`, `delta` (editable), `reason` (bericht, editable) |
| `inkooporder_plaatsen` | `{ purchasing, create_purchase_order }` | `geen` | Er gaat een bestelling naar de leverancier, dit kost geld | reviewer | 1000 | 720 | `supplierId`, `lines.0.sku`, `lines.0.qty` (editable), `lines.0.unitPrice`, `expectedDate`, `totalValue` |
| `inkooporder_wijzigen` | `{ purchasing, update_purchase_order }` | `geen` | Aantal of datum op een lopende inkooporder wijzigt | reviewer | 1000 | 720 | `poNumber`, `sku`, `qty` (editable), `expectedDate` (editable) |
| `leveranciersmail_versturen` | `{ mail, send_message }` | `geen` | Er gaat een bericht naar de leverancier | reviewer | geen | 2880 | `to`, `subject` (bericht, editable), `body` (bericht, editable), `poNumbers` |
| `retour_boeken` | `{ wms, register_return_receipt }` | `orderstatus` | Retour wordt ontvangen en voorraad wordt bijgeboekt | reviewer | geen | 10080 | `rmaNumber`, `sku`, `qty` (editable), `condition` (bericht, editable) |
| `zending_onderzoek_starten` | `{ shipping, open_investigation }` | `geen` | Er komt een dossier bij de vervoerder | reviewer | geen | 10080 | `trackingCode`, `carrier`, `reason` (bericht, editable) |
| `verzendlabel_aanmaken` | `{ shipping, create_label }` | `orderstatus` | Er wordt een label aangemaakt en goederen gaan de deur uit | reviewer | geen | 1440 | `orderNumber`, `carrier`, `address.street`, `address.postalCode`, `address.city`, `colli` (editable) |
| `monteur_inplannen` | `{ scheduling, create_appointment }` | `geen` | Er komt een afspraak in de agenda van een monteur | reviewer | geen | 1440 | `requestId`, `engineerId`, `window.start`, `window.end`, `locationAddress` |

Inkoop kost geld: drempel € 1.000, daarboven `admin`. `voorraadmutatie_boeken` staat altijd op `admin`, want dat is het enige type dat stilzwijgend de basis onder alle andere voorstellen wegtrekt. Geen enkel type mag uit het chatkanaal ontstaan.

---

## 9. Uitkomsten en identificatie

| Uitkomst | Wanneer in dit domein |
| --- | --- |
| `kennis` | Vraag over beleid of proces: retourtermijn, standaard levertijd, wie de vaste vervoerder is. Geen systeemlookup nodig. |
| `systeem` | Stand opvragen en teruggeven: orderstatus, trackingstatus, voorraadstand. Alleen als de lookup daadwerkelijk iets teruggaf. |
| `taak` | Alles wat een mutatie voorstelt: inkoop, werkbon, retourboeking, splitsing, label. Dit is het merendeel. |
| `onbekend` | Signaal zonder herleidbare order, SKU of PO. Doorvragen of overdragen, geen ticket. |

Identificatie bij externe partijen:

| Partij | Vereist niveau | Waarop |
| --- | --- | --- |
| Leverancier (inkomende mail) | `gematcht` | Afzenderdomein moet overeenkomen met het contactadres in de leveranciersstam, en er moet een bestaand PO-nummer bij |
| Vervoerder (webhook) | n.v.t., bronvertrouwen | Webhook-handtekening valideren; een statusmelding zonder geldige handtekening wordt geen signaal |
| Monteur of onderaannemer | `gematcht` | Afzender in de eigen medewerkers- of onderaannemerslijst |
| Eindklant met servicevraag | `gematcht` | Mailadres plus order- of assetnummer dat in het systeem bij elkaar hoort |
| Cron en interne webhook | `systeem` | Geen externe afzender; identificatie is niet van toepassing, maar elk actietype blijft HITL |

Een leveranciersmail met een PO-nummer dat niet bestaat, komt niet verder dan `onbekend`. Dat is de gangbaarste vector: iemand die een lever- of factuuradres probeert om te leggen.

---

## 10. Schermen en tabellen

Nav-items van de module `operations`:

| Pad | Label | Icoon | Inhoud |
| --- | --- | --- | --- |
| `/magazijn` | Magazijn | `Package` | Bestaand uit `examples/warehouse-module`. Open verzend- en picktaken, printbaar label |
| `/onderdelen` | Onderdelen | `Boxes` | Bestaand. Batchbeheer per SKU, admin-only |
| `/voorraad` | Voorraad | `Warehouse` | Standen, bestelpunten, dreigende tekorten, mutatiehistorie |
| `/inkoop` | Inkoop | `ShoppingCart` | Openstaande inkooporders, dagen over datum, leveranciersprestatie |
| `/zendingen` | Zendingen | `Truck` | Lopende zendingen per vervoerder, vastlopers bovenaan |
| `/service` | Service | `Wrench` | Werkbonnen, monteurplanning, openstaande keuringen |

Elke pagina krijgt `requireModulePage(OPERATIONS_MODULE.id)`, elke route-handler erachter `requireModule(OPERATIONS_MODULE.id, "reviewer")`.

Nieuwe tabellen:

| Tabel | Kolommen | Indexen |
| --- | --- | --- |
| `aios_stock_levels` | `id`, `organization_id`, `sku`, `location`, `on_hand int`, `allocated int`, `reorder_point int`, `lead_time_days int`, `supplier_id`, `synced_at`, `source` | `(organization_id, sku, location)` uniek, `(organization_id, on_hand)` |
| `aios_stock_adjustments` | `id`, `organization_id`, `review_item_id`, `sku`, `location`, `delta int`, `reason`, `decided_by`, `executed_at`, `created_at` | `(organization_id, sku, created_at desc)` |
| `aios_purchase_orders` | `id`, `organization_id`, `po_number`, `supplier_id`, `status`, `lines jsonb`, `total_value numeric`, `confirmed_date`, `expected_date`, `days_overdue int`, `synced_at` | `(organization_id, status)`, `(organization_id, supplier_id)` |
| `aios_suppliers` | `id`, `organization_id`, `name`, `contact_email`, `lead_time_days int`, `moq jsonb`, `otd_percentage numeric`, `return_policy`, `updated_at` | `(organization_id, name)` |
| `aios_work_orders` | `id`, `organization_id`, `review_item_id`, `request_id`, `asset_id`, `location_address`, `status`, `engineer_id`, `window_start`, `window_end`, `parts jsonb`, `created_at`, `completed_at` | `(organization_id, status)`, `(organization_id, window_start)` |
| `aios_shipment_tracking` | `id`, `organization_id`, `tracking_code`, `carrier`, `order_reference`, `status`, `last_status_at`, `events jsonb`, `stalled bool`, `updated_at` | `(organization_id, stalled, last_status_at)`, `(tracking_code)` uniek |

Een `module`-kolom nodig: `aios_shipment_tasks`, `aios_part_batches` en `aios_tickets`. Zonder die kolom belanden magazijntaken in de klantenservice-tab.

---

## 11. Demo-scenario's

Fictieve klant **Veldmaat Techniek B.V.**, groothandel en installatie, Odoo plus Sendcloud, mailbox `orders@veldmaat-techniek.example.com`.

| # | Trigger | Verloop | Uitkomst |
| --- | --- | --- | --- |
| 1 | Cron 06:00, `stock.snapshot` | SKU `VT-4410` op 6 stuks, bestelpunt 25, levertijd 14 dagen, geen openstaande inkoop. | `purchase_order` naar Brekelmans Onderdelen B.V., 60 stuks, PENDING in de werkbak |
| 2 | Webhook `order.created` | Order `SO-2026-0881`: regel 2 heeft 4 vrij, 10 besteld. | `backorder_splitsen`: 4 nu, 6 later, met concept-bericht aan de klant |
| 3 | Poll `shipment.stalled` | `3SVELD0099231` staat 5 dagen op sorteercentrum bij DPD. | `shipment_action` met `actionKind: onderzoek`, plus voorstel `zending_onderzoek_starten` |
| 4 | Mail van leverancier | `verkoop@brekelmans-onderdelen.example.com` meldt PO-2026-114 twee weken later. Domein en PO matchen. | `supplier_email` met concept-antwoord plus voorstel `inkooporder_wijzigen` (nieuwe datum) |
| 5 | Cron ma 08:00, `purchase.open` | Vier PO's over datum, één leverancier reageert twee keer niet. | Drie `supplier_email`-voorstellen, plus één `escalate` naar `supplier_risk` |
| 6 | Webhook `service.request` | Storing bij Hoogland Bouw, Zwaagdijk. Asset `AS-118`, keuring verlopen. | `work_order` met voorstel `monteur_inplannen` en twee onderdelen op de bon |
| 7 | **Escalatie.** Mail van `inkoop@brekelmans-onderdelen.example.nl` | Domein lijkt op de leverancier, staat niet in de stam, vraagt leveradreswijziging op PO-2026-114. | Gate laat door, identificatie blijft `zwak`, geen actietype mag ontstaan. Uitkomst `onbekend`, strict-review met reden in het beslislog |
| 8 | Documentupload | Pakbon-PDF van binnengekomen retour RMA-2026-31. | `stock_adjustment` plus `retour_boeken`, 3 stuks, wacht op `admin` |

---

## 12. Analytics en waarde

| KPI | Definitie | Bron |
| --- | --- | --- |
| Voorkomen tekorten | SKU's met goedgekeurd inkoopvoorstel voordat de stand onder nul kwam | `aios_stock_levels`, `aios_purchase_orders` |
| Openstaande inkoop over datum | Aantal en waarde van PO's voorbij `confirmed_date` | `aios_purchase_orders` |
| Vastgelopen zendingen | Zendingen met `stalled = true`, en hoeveel een onderzoek kregen | `aios_shipment_tracking` |
| Doorlooptijd voorstel naar besluit | Mediaan `created_at` tot `decided_at` per kind | `aios_review_items` |
| Goedkeuringsratio per kind | APPROVED plus EDITED gedeeld door totaal, per kind | `aios_review_items` |
| Correctieratio | Aandeel EDITED per specialist. Loopt dit op, dan deugt de prompt of de bron niet | `aios_review_items` |
| Leverbetrouwbaarheid per leverancier | Op tijd geleverde regels gedeeld door totaal | `aios_purchase_orders` |
| Werkbonnen per status | Open, ingepland, afgerond per week | `aios_work_orders` |

Geen enkele KPI drukt een besparing in procenten uit. De cockpit toont tellingen en doorlooptijden, wat dat waard is bepaalt de klant zelf.

---

## 13. Risico's en grenzen

**Altijd een mens.** Elke inkooporder, voorraadmutatie, verzendlabel en leveranciersmail. Niets gaat autonoom naar buiten, ook niet bij hoge confidence, ook niet uit een cron.

**Wat een verkeerde voorraadmutatie doet.** Een mutatie is de bron voor elk volgend voorstel. Boek je 200 in plaats van 20 bij, dan verdwijnt het bestelpunt uit beeld en gaat er weken later een order de deur uit die niet leverbaar is. De fout is dan niet meer aan één actie toe te wijzen. Vandaar `admin`, met `delta` als enige bewerkbare grootheid en het SKU-veld hard.

**Verouderde voorstellen.** Voorraad beweegt sneller dan een reviewer. Vandaar 720 minuten `expiresAfterMinutes` op alles wat voorraad raakt, plus hervalidatie op `orderstatus` bij goedkeuring: een voorstel op een verouderde stand gaat terug de wachtrij in.

**AVG.** Verzendadressen, leverancierscontacten, monteurnamen en klantlocaties zijn persoonsgegevens: `dataCategories: persoonsgegevens`, gemaskeerd in tool-payloads, onder het retentiebeleid. Aantekeningen bij serviceverzoeken niet meesturen naar een onderaannemer zonder noodzaak.

**Bewust niet geautomatiseerd.** Prijsonderhandeling en contractvoorwaarden. Opzeggen of vervangen van een leverancier. Betaling en incasso (finance-domein). Definitief afkeuren van geretourneerde goederen. Een leverdatum toezeggen zonder bevestiging van vervoerder of leverancier.

---

## 14. Bouwvolgorde

**Stap 1, kleinste demonstreerbare versie.** Eén trigger, één specialist, één actietype, één scherm: cron `stock.snapshot` → `replenishment` → kind `purchase_order` → actietype `inkooporder_plaatsen` → scherm `/voorraad`. Toont de hele lus inclusief cron-start en bedragdrempel. Nodig: `erp.get_stock`, `erp.get_purchase_orders`, tabellen `aios_stock_levels` en `aios_purchase_orders`.

**Stap 2.** Webhook `order.created`, specialist `order_intake`, actietypen `backorder_splitsen` en `orderstatus_bijwerken`.

**Stap 3.** Zendingen: `shipment.status_changed` plus stalled-poll, `shipment_track`, scherm `/zendingen`, MCP `factumai-mcp-shipping`.

**Stap 4.** Service en retour: `field_service`, `returns_logistics`, scherm `/service`, gekoppeld aan de bestaande magazijnschermen.

**Stap 5.** Inkoopopvolging, leveranciersrisico, maandcron en `replenishment_plan`.

Herbruikbaar uit `examples/warehouse-module`:

| Onderdeel | Status |
| --- | --- |
| `agent/hooks.ts` (`afterExecute`, idempotent via `ship-<reviewItemId>`) | Direct bruikbaar, uitbreiden naar meer dan alleen verzendtaken |
| `agent/store-shipments.ts`, fail-soft ERP-terugval | Bruikbaar, terugval behouden |
| `migrations/0008_shipment_tasks.sql`, `0011_part_batches.sql` | Bruikbaar, `module`-kolom toevoegen |
| `ui/app/(dashboard)/magazijn`, `onderdelen`, `label/[id]` | Bruikbaar als schermen |
| `specialists/missing-parts.ts` | Vorm klopt, hoort hier thuis naast `returns_logistics` |

Wat er in dat voorbeeld ontbreekt om het een volwaardige module te maken:

1. **`ModuleDescriptor`.** Geen `packages/agent-core/src/modules/operations.ts`. Zonder descriptor kent de werkbak de kinds en categorieën niet.
2. **`WorkbenchModule`.** Geen `ui/lib/modules/operations.ts` met `toCard`, `detailHref`, `collectSources` en `assistant`. Nav-items zitten nu in `ui/lib/brand.ts` `extraNavItems`: oude plek, filtert op rol en niet op module.
3. **Registry-regel.** Geen regel in `ui/lib/modules/registry.ts`.
4. **`requireModulePage`-guards.** De schermen `/magazijn` en `/onderdelen` zijn zonder guard bereikbaar door de URL in te tikken.
5. **`DomainAuditSource`.** De README noemt hem, maar hij is niet geschreven. Magazijnevents staan niet op de gedeelde tijdlijn.
6. **Eigen domain-gate en taxonomie.** De voorbeeldmodule hangt aan de klantenservice-taxonomie.
7. **Actietypen.** Geen enkel type uit dit domein staat in `ACTION_TYPES`. Alles loopt nu via de policy-vlag `createsTask`: geen preconditie, geen bedragdrempel, geen goedkeurdersrol.
8. **Tests.** Geen contracttest op de taxonomie, geen test op grounding van bedragen en aantallen, geen test die aantoont dat `voorraadmutatie_boeken` zonder tool-call wordt geweigerd. Dat drietal is het minimum voor livegang.

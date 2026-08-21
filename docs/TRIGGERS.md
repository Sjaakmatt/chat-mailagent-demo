# De triggerlaag — hoe een signaal binnenkomt

De lus begint bij een `Signal` op de bus. Dit document gaat over de vraag die
daarvóór ligt: wáár komt dat signaal vandaan.

Tot fase 2 was het antwoord altijd hetzelfde — iemand mailt. Dat is genoeg voor
klantenservice en te weinig voor de rest: administratie begint bij een post die
te lang openstaat, supply chain bij een voorraadstand, sales bij een offerte
zonder reactie. Geen van drieën begint bij een mail.

Er zijn nu vier ingangen. Ze doen allemaal exact hetzelfde: ze zetten een
`Signal(NEW)` op de bus via `aios_emit_signal`, en verder niets.

| Ingang | Wie begint | Waar in de code |
| --- | --- | --- |
| mail/chat | de klant | `channels/`, de poller-DO |
| webhook | een extern systeem | `intake/webhook.ts` |
| schedule | de klok | `intake/schedule.ts` + `aios_automations` |
| poll | wij, periodiek | `intake/poll.ts` + `aios_poll_cursors` |
| upload | een mens of een scanner | `intake/upload.ts` |

## De regel die voor alle vier geldt

**Een intake verwerkt niet.** Geen classificatie, geen lookup, geen LLM, geen
ReviewItem. Aannemen, ontdubbelen, emitten, klaar.

Dat is geen netheid maar een eigenschap. Een bron die tien events per seconde
stuurt, mag geen tien LLM-calls in een request-handler afdwingen. En verwerking
die faalt, mag de gebeurtenis niet kwijtmaken: de bus is duurzaam, de request
niet.

**Elke intake vult een idempotency-sleutel.** Alles hier kan opnieuw draaien —
een cron die twee keer tikt, een bron die zijn webhook herhaalt, een Workflow
die een step hervat. De transactional outbox uit migratie `0002` houdt er per
sleutel één over. Zonder sleutel staat er bij elke herhaling een tweede voorstel
in de werkbak.

| Ingang | Sleutel |
| --- | --- |
| webhook | `hook:<bron>:<event-id>` of een hash van de body |
| schedule | `auto:<naam>:<tijdsleuf>[:<key>]` |
| poll | `poll:<module>:<bron>:<cursorwaarde>` |
| upload | `upload:<upload-id>` of een hash van de melding |

## Webhook — `POST /hooks/:bron`

Voor externe systemen die zelf melden dat er iets gebeurd is.

Verificatie is HMAC-SHA256 over `<timestamp>.<body>`, met een geheim per bron in
`WEBHOOK_SECRET_<BRON>`. De timestamp gaat mee tegen replay (venster van vijf
minuten), de vergelijking is constant in tijd, en de body heeft een limiet.

**Een bron bestaat als er een geheim voor staat.** Er is bewust geen tweede
lijst met toegestane bronnen: die zou uit de pas gaan lopen met de secrets. Niet
ingericht is dus 404, en dat is de veilige kant.

| Situatie | Antwoord |
| --- | --- |
| Onbekende of niet-ingerichte bron | 404 |
| Handtekening, timestamp of venster klopt niet | 401 |
| Body te groot | 413 |
| Aangenomen (of al bekend) | 202 |

Een onbekende bron krijgt 404 en geen 401: het bestaan van een koppeling is zelf
informatie.

De body gaat als payload mee zoals hij binnenkwam. Niet omvormen — wat een bron
stuurt is het bewijsstuk, en wat het betekent weet de hydrator van dat domein.

### Wanneer een webhook en wanneer een MCP

Heeft de bron een MCP, dan hoort de inbound daar: die verifieert, normaliseert
naar een `Signal` en schrijft in één transactie (zie de harde regels van
`factumai-mcps`). Deze route is er voor de bronnen zonder MCP. Zonder die route
is er voor zo'n bron geen weg naar binnen, en dat houdt hele domeinen tegen.

## Schedule — de klok

Een rij in `aios_automations` bepaalt **óf en wanneer** iets draait. De code op
het modulepakket bepaalt **wát** het oplevert.

Die verdeling is het hele punt: een beheerder zet een automatisering uit zonder
deploy, en niemand kan er een taak bij verzinnen zonder code.

```ts
// packages/agent-core/src/modules/<module>/triggers.ts
export const MIJN_TRIGGERS: ModuleTriggers = {
  automations: [
    {
      name: 'ticket_opvolging',        // == aios_automations.name
      description: 'Tickets die te lang openstaan.',
      async expand(ctx) { /* → SignalDraft[] */ },
    },
  ],
};
```

Het rooster staat in `aios_automations.schedule`, in UTC:

| Vorm | Betekenis |
| --- | --- |
| `hourly` | elk uur, op het hele uur |
| `daily@08:30` | elke dag om 08:30 UTC |
| `every:15m` | elke 15 minuten (ondergrens 5) |
| `every:6h` | elke 6 uur |

Bewust geen cron-expressie. Een cron-parser is honderden regels voor
uitdrukkingskracht die niemand hier nodig heeft, en `0 8 * * 1-5` is een regel
die je verkeerd leest op de dag dat het misgaat. Alles in UTC, want een rooster
dat met de zomertijd meebeweegt draait twee keer of nul keer op de dag dat de
klok verspringt.

Een **onleesbaar rooster** zet de automatisering stil met een melding in het log.
Niet stilzwijgend terugvallen op "elk uur": dan krijgt hij een ander ritme dan er
staat, en dat merkt niemand tot de kosten oplopen.

Regels voor een expander:

- **Eén signaal per geval, geen verzamelsignaal.** De lus rust op "één signaal,
  één voorstel". Een verzamelbericht dwingt de reviewer alles of niets te nemen.
  Vul daarom `key` op elke draft — zonder die sleutel krijgen alle drafts van
  dezelfde tik dezelfde idempotency-sleutel en houdt de bus er één over.
- **Geen model.** `TriggerContext` geeft je een organisatie, een moment, de
  config van de rij en een `query` op de klant-database. Meer niet. Een expander
  stelt vast wat er is; daardoor kan er geen bedrag of datum in staan dat
  niemand kan navertellen (harde regel 4).
- **Nul is de normale uitkomst.** Meestal staat er niets te lang open.

Kent geen enkele module de naam uit de rij, dan komt er alsnog één kaal signaal
`schedule.<naam>`. De rij zegt dat er iets moet gebeuren, en dat hoort zichtbaar
te worden in plaats van stil te blijven omdat de code er nog niet is.

`last_run_at` voorkomt dat elke tik hetzelfde werk opnieuw doet. Het is een
tweede net, geen eerste: de echte ontdubbeling zit in de tijdsleuf in de
idempotency-sleutel.

## Poll — bronnen die zelf niets sturen

Een webhook is beter: dan doen we niets als er niets is. Maar lang niet elk
systeem stuurt er een. Voor een ouder ERP of een portaal zonder uitgaande
koppeling is periodiek zelf kijken de enige ingang.

```ts
export const MIJN_TRIGGERS: ModuleTriggers = {
  polls: [
    {
      source: 'openstaande_posten',       // stabiel; deel van de cursorsleutel
      description: 'Facturen die vervallen zijn.',
      mcp: 'FACTUMAI_MCP_ERP_URL',        // env-sleutel, geen URL
      tool: 'erp_list_overdue_invoices',
      input: { status: 'overdue' },
      dataCategories: ['financieel'],
      cursorField: 'updatedAt',
      toSignal: (rij) => ({ /* → SignalDraft | null */ }),
    },
  ],
};
```

De cursor staat in `aios_poll_cursors`, één rij per (organisatie, module, bron).
Daarin staat de hoogste waarde van `cursorField` die we hebben gezien; alles
daarna is nieuw. De cursor gaat als `since` mee naar de tool, en wat de bron
alsnog te veel teruggeeft, valt aan onze kant weg.

Het **cursorveld moet oplopend en stabiel zijn**. Een tijdstempel met
secondeprecisie waarin twee rijen dezelfde waarde kunnen hebben, is te grof:
dan slaat de poll rijen over.

Drie dingen die niet vanzelf spreken:

- **De cursor schuift per rij op, in volgorde, en alleen na een geslaagde emit.**
  Struikelt de bus halverwege, dan staat hij op de laatste rij die het wél
  haalde. Eén keer aan het eind de hoogste waarde wegschrijven zou de
  tussenliggende rijen stilzwijgend overslaan.
- **Fail-soft laat de cursor met rust.** Een MCP die niet antwoordt zet
  `last_error` en verder niets; de volgende ronde begint op hetzelfde punt. Een
  fout die de cursor vooruit zet, slaat rijen over.
- **`toSignal` mag `null` geven** als een opgehaalde rij geen signaal waard is.
  De cursor schuift dan wél op, anders komt diezelfde rij elke ronde terug.

Per ronde verwerkt een bron hooguit 50 rijen. Een eerste run op een bestaande
administratie levert er duizenden op; de cursor zorgt dat de volgende ronde
verdergaat waar deze stopte.

`dataCategories` is verplicht en wordt begrensd door wat de agent zelf mag
(`AGENT_DATA_CATEGORIES`). Laat je het weg, dan snijdt de MCP terug naar
`operationeel` en verdwijnen velden stilzwijgend — zie `docs/RECHTEN.md`.

## Upload — `POST /upload`

Voor een document dat een mens of een scanner aanlevert.

**De bytes gaan niet door de Worker.** Wie uploadt zet het bestand in Supabase
Storage en meldt hier waar het staat:

```json
{
  "bucket": "documenten",
  "path": "inkoop/2026/F-2026-0007.pdf",
  "filename": "F-2026-0007.pdf",
  "contentType": "application/pdf",
  "size": 84213,
  "uploadedBy": "anna@example.com",
  "uploadedAt": "2026-08-21T09:12:00.000Z"
}
```

Twee redenen. Een Worker die bestanden aanneemt moet grootte, type en hervatting
regelen voor iets wat Storage al doet. En het signaal hoort een verwijzing te
bevatten en geen kopie: een payload met een base64-factuur erin staat voorgoed
in de signaaltabel.

Authenticatie is dezelfde HMAC als bij de webhooks, met één gedeeld geheim in
`UPLOAD_SECRET`. Niet ingericht is 404. `bucket` en `path` zijn verplicht —
zonder verwijzing is er geen document, alleen een melding dát er een is.

Het resultaat is een signaal `document.uploaded`. **De extractie hoort hier
niet**: OCR en veldherkenning zitten in de hydrator van het document-domein
(`agents/mail-agent/src/hydrators/document.ts`), die draait op het moment dat de
lus het signaal oppakt. De extractie verschilt per klant en duurt seconden;
allebei redenen om het niet in een request-handler te doen.

## De cron

Alle drie de periodieke ingangen hangen aan één cron-trigger in
`wrangler.jsonc`:

```ts
async scheduled(_controller, env) {
  await Promise.allSettled([kickPoller(env), runAutomations(env), runPolls(env)]);
}
```

`allSettled` en geen `all`: één taak die omvalt mag de andere twee niet
meenemen. Datzelfde patroon zit een niveau dieper — één automatisering of één
bron die struikelt, kost niet de hele tik. Een cron die stilvalt is erger dan
een automatisering die een ronde overslaat.

## Van signaal naar envelop

Wat de intakes opleveren verschilt per domein: een mail heeft `from` en
`subject`, een poll-rij heeft een factuurnummer, een upload heeft een pad. De
kern kent geen van die velden.

Daarom leest de lus geen payload maar een `SignalEnvelope`: onderwerp, tekst,
deelnemers, verwijzingen, bijlagen, moment, plus het ruwe bewijsstuk. De
vertaling staat in `agents/mail-agent/src/hydrators/`, één bestand per domein.
Een domein toevoegen is een bestand ernaast plus een regel in de registry.

Een hydrator mag twee dingen:

- `hydrate` (optioneel, async) — ophalen wat ontbreekt. Mag falen: de lus gaat
  verder met wat er is. Een lege body levert een zichtbaar mager voorstel op, en
  dat is beter dan een run die omvalt op een MCP die even niet antwoordt.
- `toEnvelope` (verplicht, puur) — lezen wat er is. Gooit nooit.

Komt er een signaal binnen van een domein zonder hydrator, dan blijft het staan
met een leesbare reden. Niet doen alsof het een mail is.

## Welke module krijgt het

Elk modulepakket claimt zijn eigen signalen:

```ts
claims: [
  { domain: 'mail', type: 'mail.received' },
  { domain: 'schedule', type: 'schedule.ticket_opvolging' },
],
```

Eén claim per automatisering en niet het hele `schedule`-domein: zodra
administratie zijn eigen geplande taken heeft, zou een brede claim die van de
ene module bij de andere afleveren. Claimt niemand een signaal, dan blijft het
staan — `resolveModule` geeft `null` en valt niet terug op de eerste de beste
module.

## Een ingang toevoegen aan je module

1. Zet een `triggers.ts` naast je pack met `automations` en/of `polls`.
2. Hang 'm aan het pakket (`triggers: MIJN_TRIGGERS`).
3. Claim het signaaltype in `claims` — anders komt het binnen en pakt niemand
   het op.
4. Voor een automatisering: zet de rij in `aios_automations` (naam, rooster,
   `enabled`, eventueel `config`). Zonder rij draait hij niet.
5. Voor een poll: zorg dat de env-sleutel uit `mcp` gezet is. Ontbreekt hij, dan
   staat dat in `aios_poll_cursors.last_error` — een poll die stilstaat om een
   vergeten var hoort zichtbaar te zijn.

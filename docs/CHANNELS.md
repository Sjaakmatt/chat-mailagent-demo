# Kanalen — mail nu, chat later

De lus is bewust kanaal-onafhankelijk: specialisten schrijven een *antwoord*,
niet een *e-mail*. Alleen aan de randen zit kanaal-kennis. Dit document
beschrijft waar die randen zitten en wat er precies moet gebeuren om chat toe te
voegen.

## Wat er al klopt

| Laag                     | Kanaal-afhankelijk? | Waarom                                             |
| ------------------------ | ------------------- | -------------------------------------------------- |
| `Signal`                 | nee                 | `domain` + `type` zijn vrije velden                |
| classify / plan / ground | nee                 | werkt op tekst, niet op mailheaders                |
| Specialisten             | nee                 | leveren body + samenvatting                        |
| `ReviewItem`             | deels               | `kind` zegt wélk soort actie is voorgesteld        |
| Werkbak (approve/reject) | nee                 | toont een voorstel, ongeacht herkomst              |
| Bezorging                | **ja**              | mail versturen ≠ chatbericht posten                |
| Mail-detailscherm        | **ja**              | toont onderwerp, thread, bijlagen                  |

De naden staan in `packages/agent-core/src/channels/index.ts` (welke kanalen
bestaan) en `agents/mail-agent/src/channels.ts` (hoe er bezorgd wordt).

## Chat — wat er staat

Het chat-kanaal is geregistreerd en de keten is bedraad:

| Onderdeel | Waar |
| --------- | ---- |
| Kanaal | `agent-core/src/channels/` — `CHAT_CHANNEL`, realtime |
| Sessie | `agents/mail-agent/src/chat/session-do.ts` — één DO per sessie |
| Route | `GET /chat/<sessie>/ws` op de agent-Worker |
| Bezorging | `chat/delivery.ts` — schrijft het bericht én duwt het naar de sessie |
| Tickets | `chat/tickets.ts` — alleen bij uitkomst `taak` |
| Autonomie | `outcomes/mayRespondWithoutHuman()` — `kennis` en `systeem` mogen |
| Bewaking | `agent-core/src/chat-guard/` — origin, rate limiting, berichtlengte |

De sessie-DO beslist niets. Hij normaliseert een binnenkomend bericht tot een
Signal en draait er de lus op; de lus zelf (domeingrens → router → specialist →
beleidslaag) staat in `turn-runner.ts` en is exact dezelfde code die de
Orchestration-Workflow voor mail draait. Dat is de scheiding die maakt dat beide
kanalen dezelfde kern delen.

## Waarom chat een ander pad heeft dan mail

Twee kanalen met tegengestelde eisen, dus twee routes naar dezelfde lus:

| | mail | chat |
| --- | --- | --- |
| Wat telt | duurzaamheid | snelheid |
| Route | pgmq → poller (DO-alarm) → Orchestration-Workflow | rechtstreeks in de sessie-DO |
| Hervatbaar | ja, de Workflow pakt op waar hij bleef | nee — de wachtrij is het vangnet |
| Wachttijd | maakt niet uit, er kijkt niemand | elke schakel is zichtbaar |

Bij mail is de wachtrij precies goed: hij vangt pieken op, levert at-least-once
en de back-off van de poller kost niemand iets. Bij chat staat er een bezoeker
naar een leeg venster te kijken, en dan is elke schakel ertussen puur wachttijd
— de back-off van de poller, en daarna het aanmaken en inplannen van een
Workflow-instantie vóórdat de eerste LLM-call begint.

Het signaal gaat bij chat nog steeds naar de bus. Dat blijft de duurzame
vastlegging én het vangnet: valt de DO om midden in een beurt, dan pakt de
poller 'm alsnog op. De bezoeker wacht dan langer, maar zijn vraag is niet weg.

**Precies één keer, ook met twee routes.** `runSignalTurn()` zet na afloop
`status = DONE` op het signaal, en de Workflow slaat een signaal over dat al
verwerkt is. Zonder dat zou de poller de beurt overdoen en de bezoeker een tweede
antwoord sturen. Het markeren gebeurt als láátste: faalt het, dan draait de
poller 'm nog eens, en dat is minder erg dan een mislukte run als afgehandeld
markeren.

## Identificatie: pas vragen als het nodig is

De widget heeft geen e-mailveld. Een identificatievraag vóór de eerste vraag is
een drempel voor een gesprek dat 'm meestal niet nodig heeft — een vraag over een
prijs of een levertijd gaat niemand persoonlijk aan.

Moet de agent iets opzoeken dat aan een persoon hangt, dan vraagt hij er zelf om
(`CONFIRMATION.needsIdentityText`) en typt de bezoeker het in zijn antwoord.
`extractEmail()` in `chat-guard` haalt het adres uit de tekst; de sessie onthoudt
het daarna, dus het hoeft maar één keer.

Dat de chat strenger is dan mail blijft staan: voor een systeemantwoord zijn
mailadres én ordernummer nodig (`identificationPolicy`). Bij mail volstaat het
afzenderadres, want dat komt van het mailsysteem en er gaat hoe dan ook een mens
overheen.

### Zelf uitproberen

1. Zet `DEMO_MODE=true` op de agent-Worker en deploy.
2. Open `https://<agent-worker>/chat` — een zelfstandige testwidget.
3. Vul een e-mailadres in (nodig voor `systeem`-antwoorden en tickets) en typ.
4. Volg mee in de cockpit: **Gesprekken** toont het verloop, **Tickets** wat
   eruit kwam, en het beslislog op elk ReviewItem waaróm.

Probeer in elk geval deze vier: een productvraag (`kennis`), een statusvraag met
ordernummer (`systeem`), een retourmelding (`taak` → ticket met nummer), en iets
buiten het domein (vaste afwijzingstekst).

Dit blijft een **testwidget**: één pagina om de keten te doorlopen, zonder
klant-styling. Voor een echte site is er de productiewidget hieronder.

### De productiewidget

Plaatsing op de site van de klant is één regel:

```html
<script src="https://<agent-worker>/widget.js"
        data-accent="#0f766e"
        data-title="Klantenservice"
        data-greeting="Hoi! Waar kan ik je mee helpen?"
        data-position="right"></script>
```

Dat zet een knop rechtsonder en een paneel erboven. Twee endpoints, beide
statisch — er wordt niets van de server in de HTML of JS geïnterpoleerd, dus er
is geen injectie-oppervlak:

| Route | Wat |
| ----- | --- |
| `GET /widget.js` | loader op de klantsite: knop, iframe, sessiebeheer |
| `GET /widget` | de iframe-inhoud (de chat zelf) |

Beide staan **niet** achter `DEMO_MODE` — dit is productiefunctionaliteit. Wie
'm mag insluiten regelt `frame-ancestors`, niet een vlag.

**Waarom een iframe.** De CSS van de klantsite kan de widget dan niet breken en
andersom; dat scheelt per klant een middag uitzoeken waarom de knop achter een
sticky header valt. De prijs is dat insluiting niet met de origin-check op de
socket te bewaken is — de iframe komt van de Worker, dus die socket heeft altijd
de Worker als `Origin`. Daarom zet `GET /widget` een
`Content-Security-Policy: frame-ancestors` uit `CHAT_ALLOWED_ORIGINS`: de
browser weigert dan te renderen op een site die er niet in staat, en dát kan een
site niet omzeilen. Staat de var leeg, dan is het `'self'`.

**Sessie.** De loader bewaart een sessie-id in `localStorage` van de klantsite,
zodat doorklikken naar een productpagina het gesprek niet afbreekt. Bewust geen
cookie: de widget hoort niets mee te sturen in verzoeken naar de klantsite.

**Herverbinden.** Valt de socket weg, dan probeert de widget opnieuw met
oplopende wachttijd tot maximaal 30 seconden. Het verloop komt uit
`aios_messages`, dus na een herverbinding staat het gesprek er nog — ook als het
Durable Object intussen is gehiberneerd.

### Bewaking op het kanaal

Mail komt binnen via een MCP met eigen auth. Chat komt van een willekeurige
bezoeker, er zit geen mens tussen, en elk bericht kost LLM-calls op de sleutel
van de klant. Daarom staat er bewaking vóór de lus, in
`agent-core/src/chat-guard/` — puur en getest, zodat een tweede realtime kanaal
'm kan hergebruiken.

| Var | Doet | Default |
| --- | ---- | ------- |
| `CHAT_ALLOWED_ORIGINS` | Welke sites de widget mogen insluiten | alleen de Worker zelf |
| `CHAT_RATE_PER_MIN` | Berichten per minuut per sessie | 10 |
| `CHAT_MAX_PER_SESSION` | Harde bovengrens per sessie | 100 |
| `CHAT_MAX_MESSAGE_CHARS` | Max lengte van één bericht | 2000 |

Twee dingen om goed te begrijpen:

**De origin-check is geen beveiliging tegen scripts.** Hij houdt tegen dat een
*andere website* jouw widget insluit en op jouw rekening laat praten. Wie zelf
HTTP doet, zet de `Origin`-header op wat hij wil. De rate limiting is de enige
harde grens op kosten — die telt per sessie in de duurzame opslag van het
Durable Object, dus een eviction reset 'm niet.

**Ongezet betekent dicht, niet open.** Zonder `CHAT_ALLOWED_ORIGINS` mag alleen
de Worker zelf een sessie openen. Dat houdt de testwidget werkend en sluit de
rest uit; een vergeten var zet de deur dus niet open. Zodra de widget op een
echte site staat, horen die domeinen erin.

Een geweigerd bericht wordt géén Signal en start dus geen lus. De bezoeker
krijgt een `notice` over de socket — een eigen berichttype, zodat een widget het
anders kan tonen dan een antwoord van de agent, en het niet in de logging belandt.

### De gate die nog moet vallen

`pnpm gate` draait de adversariële set tegen een écht model:

```bash
ANTHROPIC_API_KEY=sk-... pnpm gate
```

De unit-tests meten de mechaniek — dat een `false` overal `false` blijft. Dit
script meet het oordeel: blokkeert het model wat het moet blokkeren, en laat het
gewone klantvragen door? Een poort die alles tegenhoudt is net zo kapot als een
poort die alles doorlaat, dus het telt beide kanten.

Lekt er iets door, dan faalt het script — scherp `DOMAIN.outOfScope` aan.
Draai dit vóórdat chat naar een echte bezoeker gaat: daar gaan `kennis` en
`systeem` zonder mens naar buiten.

## De autonomie-vraag — beantwoord

Chat is realtime en mail niet. Dat is geen technisch detail maar de kern van het
ontwerp: bij mail is een mens-in-de-lus vanzelfsprekend, want een paar minuten
wachttijd valt niemand op. Bij chat zit er iemand te wachten.

Er zijn drie werkbare antwoorden. **Gekozen is nummer 2, strak begrensd:**
`kennis` en `systeem` mogen direct naar de bezoeker, `taak` en `onbekend` niet.
Dat staat in `mayRespondWithoutHuman()` en wordt afgedwongen door tests.

Wat die keuze houdbaar maakt, is dat er drie dingen vóór staan: de domeingrens
blokkeert alles buiten het domein, de grounding-check weigert claims zonder
dekking, en `systeem` degradeert naar `taak` zodra identificatie of
systeemantwoord ontbreekt. Valt één daarvan weg, dan is deze keuze niet meer
verdedigbaar.

De alternatieven, voor als je erop terug wilt komen:

1. **Chat afhandelen als asynchroon kanaal.** De agent bevestigt direct ("we
   zoeken het uit"), het echte antwoord gaat langs review. Traag maar veilig, en
   het houdt harde regel 1 intact.
2. **Auto-send binnen een strakke grens.** Alleen `simple_reply` boven een hoge
   confidence, alleen op vragen zonder feitelijke claims. Vereist een expliciete
   afspraak met de klant en een aparte `autonomy = AUTO` op precies die route.
3. **Mens-in-de-lus met een klok.** Reviewer krijgt een paar seconden om in te
   grijpen; daarna gaat het voorstel eruit. Vereist een cockpit die realtime
   duwt in plaats van pollt.

Wil een klant een ander regime, leg dat dan vast in `client.manifest.yaml` en
pas `mayRespondWithoutHuman()` aan — niet de prompts.

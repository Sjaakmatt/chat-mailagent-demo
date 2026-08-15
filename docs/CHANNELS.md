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

De sessie-DO beslist niets. Hij normaliseert een binnenkomend bericht tot een
Signal en zet dat op dezelfde work-bus als mail; de lus (domeingrens → router →
specialist → beleidslaag) draait daarbuiten. Dat is de scheiding die maakt dat
beide kanalen dezelfde kern delen.

### Zelf uitproberen

1. Zet `DEMO_MODE=true` op de agent-Worker en deploy.
2. Open `https://<agent-worker>/chat` — een zelfstandige testwidget.
3. Vul een e-mailadres in (nodig voor `systeem`-antwoorden en tickets) en typ.
4. Volg mee in de cockpit: **Gesprekken** toont het verloop, **Tickets** wat
   eruit kwam, en het beslislog op elk ReviewItem waaróm.

Probeer in elk geval deze vier: een productvraag (`kennis`), een statusvraag met
ordernummer (`systeem`), een retourmelding (`taak` → ticket met nummer), en iets
buiten het domein (vaste afwijzingstekst).

De widget is een **testwidget**: geen klant-styling, geen herverbindingslogica,
en hij hoort niet op de site van een klant. Een insluitbare productiewidget is
nog te bouwen.

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

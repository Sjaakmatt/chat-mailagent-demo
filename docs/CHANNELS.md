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

### Nog te doen voordat chat live kan

- **De widget.** Er is een websocket-endpoint maar geen bezoekerskant.
- **Cockpit-conversatieweergave.** Het detailscherm toont mailvelden; een
  chatgesprek verdient een gespreksweergave.
- **De adversariële set tegen een echt model.** De tests in
  `domain-gate.test.ts` meten de mechaniek, niet het oordeel. Dit is de gate
  uit bouwbriefing §6 en die staat nog open.

### 2. Signalen laten binnenkomen

De chat-MCP emit `chat.message`-signalen via dezelfde `aios_emit_signal`-RPC als
de mail-MCP. De poller pikt ze op zonder aanpassing — de queue is kanaal-agnostisch.

Payload-velden die de plan-stap verwacht: een tekst (`bodyText`) en genoeg
context om de afzender te herkennen. Houd de shape zo dicht mogelijk bij die van
mail, dan werkt `resolve` ongewijzigd.

### 3. Bezorgroutine schrijven

Voeg in `agents/mail-agent/src/channels.ts` een regel toe:

```ts
const DELIVERY: Record<string, DeliveryFn> = {
  draft_email: deliverMailReply,
  draft_chat_reply: deliverChatReply,
};
```

`deliverChatReply` post het goedgekeurde antwoord via de chat-MCP. Idempotent,
net als de mailvariant: bij een herhaalde Workflow-step mag er geen tweede
bericht in de conversatie verschijnen.

### 4. Cockpit-weergave

Het detailscherm (`ui/app/(dashboard)/mail/[id]/page.tsx`) toont mailvelden.
Voor chat wil je een conversatieweergave. Splits op `item.kind` en render per
kanaal; de werkbak-kaarten en de goedkeuringsknoppen kunnen blijven zoals ze zijn.

### 5. De vraag die je eerst moet beantwoorden

Chat is realtime en mail niet. Dat is geen technisch detail maar de kern van het
ontwerp: bij mail is een mens-in-de-lus vanzelfsprekend, want een paar minuten
wachttijd valt niemand op. Bij chat zit er iemand te wachten.

Drie werkbare antwoorden:

1. **Chat afhandelen als asynchroon kanaal.** De agent bevestigt direct ("we
   zoeken het uit"), het echte antwoord gaat langs review. Traag maar veilig, en
   het houdt harde regel 1 intact.
2. **Auto-send binnen een strakke grens.** Alleen `simple_reply` boven een hoge
   confidence, alleen op vragen zonder feitelijke claims. Vereist een expliciete
   afspraak met de klant en een aparte `autonomy = AUTO` op precies die route.
3. **Mens-in-de-lus met een klok.** Reviewer krijgt een paar seconden om in te
   grijpen; daarna gaat het voorstel eruit. Vereist een cockpit die realtime
   duwt in plaats van pollt.

Kies er één bewust en leg 'm vast in `client.manifest.yaml`. Bouw geen chat
zonder dat die keuze is gemaakt — dan sluipt optie 2 er per ongeluk in.

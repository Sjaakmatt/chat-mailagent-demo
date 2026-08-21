# Golden set

Gelabelde berichten die de lus vastleggen zoals hij zich hoort te gedragen.
Draaien met `pnpm eval:golden`; de runner staat in `scripts/golden.ts` en loopt
mee in CI.

## Wat er gemeten wordt

Niet het oordeel van het model — dat meet `scripts/adversarial-gate.ts` tegen een
echt model, met een API-sleutel. Hier draait een `FakeLlmClient`: elke regel
draagt zowel het bericht als het antwoord dat het model erop zou geven.

Wat dan overblijft is de mechaniek eromheen, en die is van ons:

| Van | Naar | Waar het woont |
| --- | --- | --- |
| poort dicht | `category: buiten_domein`, run stopt vóór de router | `orchestrate/runRoute` |
| categorie | specialist | `taxonomy/index.ts` |
| specialist + geëxtraheerde velden | uitkomst | `outcomes/index.ts` |

Die drie verhuizen in fase 1 naar `modules/klantenservice/`. Dat hoort een
verplaatsing te zijn en geen gedragswijziging, en deze set is wat dat bewijst.

## Eén regel

```json
{
  "id": "g01",
  "naam": "statusvraag met ordernummer",
  "signal": { "subject": "…", "bodyText": "…", "from": "…@example.com" },
  "llm": {
    "gate": { "inDomain": true, "reason": "…" },
    "classify": { "category": "levertijd_status", "confidence": 0.93, "extracted": { "orderNumber": "…" } }
  },
  "verwacht": { "in_domain": true, "category": "levertijd_status", "specialist": "simple_reply", "outcome": "systeem" }
}
```

`llm` is wat het model zou antwoorden, `verwacht` is wat de lus daarvan moet
maken. Een veld dat je in `verwacht` weglaat, wordt niet getoetst — bij een
bericht buiten het domein is er geen specialist en geen uitkomst, en die
afwezigheid is de uitkomst.

## Bijwerken

Zakt de set na een **refactor**, dan is er gedrag veranderd dat gelijk had moeten
blijven. Repareer de code, niet de set.

Zakt hij na een **bewuste** wijziging in de taxonomie, de uitkomsten of de poort,
dan werk je deze bestanden bij. Dat staat dan in de diff naast de wijziging zelf,
en dat is precies waar je het wilt zien.

De data is verzonnen en blijft dat: `example.com`, geen echte klantnamen, geen
echte ordernummers. Een klant die dit fundament kloont, vervangt de set door
berichten uit zijn eigen taxonomie.

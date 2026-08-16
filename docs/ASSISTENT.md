# De werkbak-assistent — laag 1, het dossier

Een raadpleegvenster naast het werk. Een medewerker die een voorstel beoordeelt,
kan vragen stellen over dat voorstel, de klant, het beleid en eerder afgehandelde
zaken. Eén invoerveld, geen tweede.

**Hij voert niets uit en verstuurt niets.** Dat is niet alleen een promptregel:
er zit in de hele assistent-laag geen enkele schrijfroute. Alles wat naar buiten
gaat, gaat via de bestaande knoppen.

## Wat hij kan

| Vraag | Bron |
| --- | --- |
| Waarom stelt hij dit voor? | Het beslislog van die run: poort, categorie, specialist, stappen, geraadpleegde bronnen, afgekeurde claims |
| Wat is de geschiedenis van deze klant? | Eerdere tickets van hetzelfde e-mailadres |
| Welk beleid geldt hier? | De beleidsregels die op de categorie matchen, met de vindplaats |
| Is dit eerder voorgekomen? | Eerder besliste voorstellen in dezelfde categorie, met wat er toen is besloten |

Alles komt uit de klant-database. Er gaat geen MCP-call uit en er wordt niets
geaggregeerd — dat is laag 2 en dat is een ander product.

## De regel

**Elke bewering is herleidbaar naar een bron uit dezelfde vraag.** Dat is de
bestaande numerical-grounding-regel, toegepast op een antwoord aan een
medewerker. Hier is hij zo mogelijk belangrijker: een klant leest een concept dat
een mens nog nakijkt, maar een medewerker die de assistent iets vraagt, handelt
ernaar.

Twee controles in `finalizeAssistantAnswer`, met een verschillende betekenis:

| Controle | Wanneer hij afgaat |
| --- | --- |
| **verzonnen bron** | Een citaat wijst naar een bron-id die niet bestaat — het model heeft een bron gefabriceerd om een bewering te dekken |
| **ongedekt getal** | Een getal in het antwoord komt in géén enkele aangeleverde bron voor. De assistent zag niets anders, dus hij kan het nergens anders vandaan hebben |

Beide zijn waar-per-constructie: er is geen legitieme manier waarop ze afgaan op
een correct antwoord.

**Zakken is inhouden, niet waarschuwen.** Een antwoord dat de controle niet
haalt, gaat niet met een randje eromheen naar de gebruiker — hij krijgt de reden
en de bronnenlijst. Half tonen is gevaarlijker dan niet tonen: de helft die klopt
maakt de helft die niet klopt geloofwaardig.

**"Ik weet het niet" is een goede uitkomst.** Het model heeft een expliciet veld
om te zeggen dat het er niet staat. Modellen zonder dat veld vullen de leegte.

## Bronnen zijn zichtbaar

Onder elk antwoord staat wat de assistent heeft ingezien, met een link erheen, en
welke daarvan hij heeft geciteerd. Standaard zichtbaar, niet uitklapbaar. Een
medewerker die een getal doorgeeft aan een klant moet kunnen zien waar het
vandaan komt zonder ergens op te moeten klikken.

Bij een weigering gaat die lijst ook mee: dan ziet hij wat de assistent wél had
en kan hij zelf kijken.

## Rechten

Drie poorten, in oplopende kosten, voordat er een model aan te pas komt:

1. **De vlag** — `ASSISTANT_DOSSIER=true` én een `ANTHROPIC_API_KEY`. Zonder
   allebei blijft hij uit; een halve configuratie hoort een uitgeschakelde
   assistent op te leveren en geen fout bij de eerste vraag.
2. **De rol** — minimaal `viewer`. Wie mag meekijken, mag vragen stellen over
   wat hij ziet.
3. **De modulegrant** — dezelfde grens als bij goedkeuren: over een proces waar
   je niet bij hoort, stel je ook geen vragen. Dat is de doorsnede van afname,
   toewijzing en rol; zie [`RECHTEN.md`](./RECHTEN.md).

En één die geen poort is maar een eigenschap: **de bronnen komen van de module**,
via `WorkbenchModule.collectSources`. Er is geen gedeelde functie met een
module-parameter, dus de klantenservice-assistent kán geen sales-bron krijgen —
ook niet als er ergens een verkeerde id wordt doorgegeven. Een module zonder
`collectSources` heeft geen assistent; ook dat is fail-closed.

Datacategorieën spelen in laag 1 nog geen rol: de cockpit leest zijn eigen
database, en daar staan geen inkoopprijzen of marges — die zitten in de
bronsystemen achter de MCP's, waar de veldclassificatie ze wegsnijdt. Bij laag 2
komt die grens hier wel binnen, want dan lopen er MCP-calls doorheen.

## Aanzetten

```jsonc
// ui/wrangler.jsonc
"vars": {
  "ASSISTANT_DOSSIER": "true",
  "MODEL_ASSISTANT": "claude-sonnet-4-6"
}
```

```bash
cd ui && npx wrangler secret put ANTHROPIC_API_KEY
```

Bewust opt-in: hij kost per vraag geld en hoort bij een klant die 'm heeft
gekocht. De vlag hoort per tenant in het control plane; tot dat er is, staat hij
als var op de Worker.

## Waar het staat

| Wat | Waar |
| --- | --- |
| Contract, prompt, controle | `packages/agent-core/src/assistant/` |
| Bronnen ophalen | `ui/lib/modules/klantenservice-sources.ts` — per module |
| Eén vraag, end-to-end | `ui/lib/assistant/run.ts` |
| API | `ui/app/api/assistant/route.ts` |
| Paneel | `ui/components/assistant/AssistantPanel.tsx` |

## Laag 2 — de analyse-laag

Aggregeren over verzamelingen: klachtenpercentages, doorlooptijden, marges. Een
ander product met een andere koper, maar dezelfde codebase met een schakelaar.

**De vlag beslist niet alleen.** `ASSISTANT_ANALYSE=true` zet 'm aan, maar de
drie voorwaarden uit de bouwbriefing worden gecontroleerd in plaats van
vertrouwd:

| Voorwaarde | Waarom |
| --- | --- |
| Alle velden in de gekoppelde MCP's hebben een categorie | Een veld zonder categorie is voor niemand opvraagbaar; een ongeclassificeerde MCP levert lege antwoorden op waar de gebruiker geen verklaring voor heeft |
| Minstens één aggregatietool beschikbaar | Zonder aggregatie kan de laag alleen weigeren |
| Minstens één rol mag commercieel of financieel zien | Anders is er niemand voor wie de laag iets kan betekenen |

Voldoet er iets niet, dan blijft de laag uit **met de reden erbij** — te zien op
de Toegang-pagina. Geen halve activering: een analyse-assistent die aanstaat maar
bij de helft van de velden niets kan, wekt de indruk dat er niets te halen valt.

De rapporten komen van de MCP's zelf (`list_field_categories`), niet uit een
registerbestand: de controle mag niet leunen op een lijst die iemand had moeten
bijwerken. Een MCP die zich niet meldt telt als **niet gehaald** — onbereikbaar
is niet hetzelfde als in orde.

## Wat er nog niet in zit

- **De vraagroute van laag 2.** De schakelaar en de voorwaardencontrole staan;
  de assistent kan nog geen aggregatie ópvragen. Dat is de volgende stap: de
  aggregatietools als bron aanbieden, weigeren als de gevraagde aggregatie niet
  bestaat, en elk cijfer tonen mét periode, populatie en definitie.
- **Alleen bij een openstaand voorstel.** Het paneel hangt aan de itempagina. Een
  invoerveld zonder open item — met de werkbak als context — komt als laag 2 er
  is, want dan is er ook iets zinnigs te vragen zonder item.
- **Geen geheugen tussen vragen.** Elke vraag staat op zichzelf. Dat houdt de
  controle eerlijk: er is geen eerdere beurt waaruit een bewering kan lekken die
  niet meer in de bronnen staat.

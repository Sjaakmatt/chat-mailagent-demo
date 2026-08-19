# De werkbak-assistent — laag 1, het dossier

Een gespreksvenster in de werkbak zelf, rechtsonder, op elk scherm bereikbaar.
Eén invoerveld, geen tweede.

## Waar hij zit, en waarom dat uitmaakt

Hij hing eerst op het detailscherm van een werkitem. Dat was de verkeerde plek:
zo is hij er alleen als je al weet welk item je nodig hebt, en juist de vragen
dáárvoor — "welk beleid geldt bij een creditnota", "wat staat er nog open" — kon
je nergens kwijt.

Nu hangt hij aan de schil en schuift het **onderwerp** mee:

| Waar je staat | Waar het gesprek over gaat | Bronnen |
| --- | --- | --- |
| Een voorstel open | dat voorstel, die klant | `collectSources(client, row)` |
| Ergens anders in de werkbak | het proces zelf | `collectGeneralSources(client)` |

Dat onderwerp komt niet uit de URL maar van het scherm: een pagina met een
onderwerp rendert `<AssistantSubject reviewItemId label>`, en dat vervalt zodra
je wegnavigeert. Zou de schil de routes van een module moeten kennen om te weten
waar je naar kijkt, dan zat er mailkennis in een kernbestand van de cockpit — de
regressie die [`MODULES.md`](./MODULES.md) verbiedt.

Een nieuw onderwerp is een nieuw gesprek: de draad wordt leeggemaakt. Doorpraten
over voorstel B met de beurten van voorstel A erboven levert antwoorden op die
kloppen bij de verkeerde zaak, en dat is het soort fout dat niemand opmerkt.

## Het gesprek is context, geen bron

Eerdere beurten gaan mee zodat "en die klant?" te begrijpen is. Ze tellen
**niet** mee als dekking: `finalizeAssistantAnswer` kijkt uitsluitend naar de
bronnen van déze beurt. Zou het anders zijn, dan kan een verzonnen getal
zichzelf legitimeren door één beurt te overleven — het staat immers in het
gesprek. Er is een test die precies dat afdwingt.

Wat de browser meestuurt is dus onbetrouwbaar én onschadelijk; `normalizeHistory`
begrenst het tot zes beurten zodat niemand er een prompt van willekeurige lengte
doorheen schuift.

**Hij voert niets uit en verstuurt niets.** Dat is niet alleen een promptregel:
er zit in de hele assistent-laag geen enkele schrijfroute. Alles wat naar buiten
gaat, gaat via de bestaande knoppen.

## Wat hij kan

**Hij geeft inzicht, geen procedurele hulp.** De vragen die een medewerker
werkelijk heeft gaan over aantallen en patronen: hoeveel klachten heeft deze
klant gedaan, hoeveel kwam er vandaag binnen, hoe vaak komt dit verzoek terug,
bij hoeveel klanten speelt het. Dat kon hij niet — hij kon uitleggen en
verantwoorden, en dat is iets anders dan overzicht geven.

De tellingen staan in `assistant/inzicht.ts` en worden **deterministisch**
gedaan, niet door het model: harde regel is dat het model niet rekent. Het
resultaat gaat uitgeschreven de bron in, het model leest en citeert, en daarmee
dekt de bestaande grounding-controle de cijfers vanzelf. Daarom staat er ook een
regel per dag in plaats van een reeks datums — een model dat zelf moet optellen,
mag dat niet en doet het toch.

Die module weet niets van mail. Hij krijgt rijen aangeleverd en telt; wélke
rijen bepaalt de módule, en die geeft alleen zijn eigen werk mee. Een tweede
automatisering krijgt hetzelfde inzicht over zijn eigen bak zonder dat er iets
verandert.

**Hij is er voor de medewerker, niet voor de klant.** Dat onderscheid stuurt wat
hij mag lezen en welke voorbeeldvragen er staan. "Wat kost module X" is een
klantvraag: die hoort de agent te beantwoorden in een concept dat langs een mens
gaat. De assistent beantwoordt de vraag díé mens heeft — mag ik dit goedkeuren,
waar komt dat bedrag vandaan, wat is hier eerder besloten. Staat er een
klantvraag als voorbeeld in het venster, dan wordt het een productencyclopedie
en mist het waar het voor is.

Bij een geopend voorstel:

| Vraag | Bron |
| --- | --- |
| Hoe vaak heeft deze klant gemaild, en waarover? | Zijn eigen berichten geteld en per categorie verdeeld |
| Mag ik dit zelf goedkeuren? | De klaargezette acties, met de vereiste rang uit dezelfde registratie als de knop |
| Waar komt dit bedrag vandaan? | De payloadvelden met hun dekking per veld, en de systeemstaat waarop het voorstel rust |
| Waarom stelt hij dit voor? | Het beslislog van die run: poort, categorie, specialist, stappen, geraadpleegde bronnen, afgekeurde claims |
| Wat is de geschiedenis van deze klant? | Eerdere tickets van hetzelfde e-mailadres |
| Welk beleid geldt hier? | De beleidsregels die op de categorie matchen, met de vindplaats |
| Is dit eerder voorgekomen? | Eerder besliste voorstellen in dezelfde categorie, met wat er toen is besloten |

En zonder:

| Vraag | Bron |
| --- | --- |
| Hoeveel kwam er vandaag binnen? | Volume per dag over veertien dagen, plus vandaag per categorie |
| Hoeveel klachten heeft klant X? | Per klant: berichten, klachten, tickets, verdeling over categorieën |
| Hoe vaak komt dit verzoek terug? | Per categorie hoe vaak én bij hoeveel verschillende klanten |
| Hoe vaak vraagt iemand waar zijn bestelling blijft? | Idem — dat is één categorie, uitgeschreven |
| Wat wacht er op mijn goedkeuring? | De openstaande schrijfoperaties, geteld per vereiste rang |
| Wat staat er nu open? | De werkvoorraad, uitgeschreven per status en per categorie |
| Welke tickets liggen er nog? | De openstaande tickets, met wie ze heeft opgepakt |
| Welk beleid geldt bij X? | Alle actieve beleidsregels van deze module |
| Wat is er recent afgehandeld? | De laatste besliste voorstellen, met wie en wanneer |

De werkvoorraad staat er bewust **uitgeschreven** in en niet als losse getallen
in de prompt: de assistent mag geen getal noemen dat niet letterlijk in een bron
staat, en hij mag niet rekenen. Wil je dat hij "er staan er zeven open" kan
zeggen, dan moet die zeven in de brontekst staan.

Wat er zonder voorstel **niet** in zit is een klantdossier. Zonder voorstel is er
geen klant om over te praten; vraagt iemand er toch naar, dan is "dat staat er
niet" het juiste antwoord — hij opent het item en de assistent kijkt mee.

Alles komt uit de klant-database. Er gaat geen MCP-call uit en er wordt niets
geaggregeerd — dat is laag 2 en dat is een ander product.

## De regel

**Elke bewering is herleidbaar naar een bron uit dezelfde vraag.** Dat is de
bestaande numerical-grounding-regel, toegepast op een antwoord aan een
medewerker. Hier is hij zo mogelijk belangrijker: een klant leest een concept dat
een mens nog nakijkt, maar een medewerker die de assistent iets vraagt, handelt
ernaar.

### Laag 2 is een aanvulling, geen poort

Staat de analyse-vlag aan, dan kijkt de assistent eerst of er een aggregatie bij
de vraag past. Past er geen, dan gaat de vraag gewoon door het dossierpad. Dat
klinkt vanzelfsprekend, maar de code deed een tijd het omgekeerde: elke uitkomst
die geen aggregatie was, werd een weigering van de héle vraag. Met de vlag aan
en een rol die commercieel of financieel mag zien, kreeg je op "welk beleid
geldt hier" te horen dat de aggregatie niet bestond — op elke vraag die niet
toevallig een telling was.

Het onderscheid dat telt zit in `resolveAnalysePlan`:

De regel: **weiger alleen als er een échte aggregatie is gekozen die niet
geleverd kan worden.**

| Uitkomst | Wat er gebeurt |
| --- | --- |
| Het model zegt dat er niets te tellen valt | Doorlopen naar het dossierpad |
| Het model verzint een toolnaam | Doorlopen — er ís dan geen aggregatie gekozen |
| Onleesbaar plan | Doorlopen |
| Bestaande tool, maar geen periode | Weigeren: noem een periode |
| Bestaande tool, maar de MCP faalt of je mag het niet zien | Weigeren mét de reden |

Die verzonnen toolnaam is geen randgeval. Modellen vullen `cannotAnswer` lang
niet altijd in; ze kiezen liever iets dat er ongeveer op lijkt. Bij "hoeveel
tickets staan er open?" komt er met een catalogus van twee aggregaties een derde
uit die niet bestaat — en weigeren is daar onzin, want het aantal staat gewoon
in de werkvoorraad-bron. Doorlaten is veilig omdat het dossierpad niets kan
verzinnen: elk getal moet daar letterlijk in een bron staan.

De onderste twee blijven een weigering, want daar vroeg iemand om een concreet
cijfer dat wél bestaat. Een verhaal terugkrijgen betekent dat hij het getal zelf
invult.

### Het voorfilter ervoor

`mightBeAggregationQuestion` kijkt vóór de planner of er überhaupt om een
grootheid wordt gevraagd. Puur kosten: zonder dat deed élke vraag eerst een
modelcall om te horen dat er niets te tellen viel.

Het is nadrukkelijk **geen poort** — poorten in dit product zijn mechanismen,
geen inschattingen. Hij kan ook niets tegenhouden: ten onrechte ja kost één
overbodige call, ten onrechte nee stuurt de vraag naar het dossierpad, waar
dezelfde grounding-controle staat. In geen van beide gevallen ontstaat er een
getal dat er niet hoort. Daarom staat de lijst ruim: bij twijfel ja.

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

## Bronnen zijn zichtbaar, in twee balkjes

Onder elk antwoord staan twee inklapbare balkjes: **Onderbouwing** (welke
bewering door welke bron gedekt wordt) en **Ingezien** (alles wat de assistent
kreeg, met een link erheen en gemarkeerd wat hij heeft geciteerd).

Ze stonden eerst allebei open. Bij één bron valt dat mee; bij negen bronnen en
zes citaten verdwijnt het antwoord boven een muur van herkomst en leest niemand
het meer — de herkomst ook niet. Dichtklappen maakt het antwoord weer leesbaar.

De **telling staat in de kop** en dat is het hele punt van de constructie. Je
ziet zonder klikken dát er zes beweringen onderbouwd zijn en negen bronnen zijn
ingezien; je klikt alleen als je wilt weten wélke. Een balkje zonder telling zou
hetzelfde verstoppen als weglaten, en dan is de grounding-belofte iets waar je
maar op moet vertrouwen.

Het zijn `<details>`-elementen en geen eigen open/dicht-state: toetsenbord,
schermlezer en zoeken-op-de-pagina werken dan zonder dat wij daar iets voor
doen.

Bij een weigering gaat de bronnenlijst ook mee: dan zie je wat de assistent wél
had en kun je zelf kijken.

## Rechten

Drie poorten, in oplopende kosten, voordat er een model aan te pas komt:

1. **De vlag** — `ASSISTANT_DOSSIER=true`, een `ANTHROPIC_API_KEY` én een
   `MODEL_ASSISTANT`. Zonder alle drie blijft hij uit; een halve configuratie
   hoort een uitgeschakelde assistent op te leveren en geen fout bij de eerste
   vraag. Het model-id staat er bewust bij en heeft géén terugval in code: een
   hardcoded id overtreedt harde regel 7 en verbergt bovendien een ontbrekende
   var tot de eerste vraag.
2. **De rol** — minimaal `viewer`. Wie mag meekijken, mag vragen stellen over
   wat hij ziet.
3. **De modulegrant** — dezelfde grens als bij goedkeuren: over een proces waar
   je niet bij hoort, stel je ook geen vragen. Dat is de doorsnede van afname,
   toewijzing en rol; zie [`RECHTEN.md`](./RECHTEN.md).

En één die geen poort is maar een eigenschap: **de bronnen komen van de module**,
via `WorkbenchModule.collectSources` en `collectGeneralSources`. Er is geen
gedeelde functie met een module-parameter, dus de klantenservice-assistent kán
geen sales-bron krijgen — ook niet als er ergens een verkeerde id wordt
doorgegeven. Een module zonder `collectSources` heeft geen assistent op een
voorstel; een module zonder `collectGeneralSources` heeft er geen buiten een
voorstel om, en dan staat het venster er ook niet. Beide fail-closed.

Bij een geopend voorstel hangt de modulegrant aan de módule van dat item; zonder
voorstel aan de module die de medewerker zelf open heeft. Vandaag is dat er één,
en dan hoeft het scherm er niets over te weten.

**De bronnen zijn óók begrensd, niet alleen de toegang.** Dat is een apart
punt en het is de plek waar het bij een tweede module misgaat als je er niet op
let. Een gesprek over één voorstel is vanzelf goed — dat item hoort bij één
module. Een generieke vraag leest lijsten, en een lijst kent de grens niet:
`listReviewRows` geeft álles terug. Daarom zeeft `collectGeneralSources` op de
eigen module (op `module`, met `kind` als terugval) en op de eigen categorieën
voor het beleid. Zonder die zeef ziet een klantenservicemedewerker straks de
sales-werkvoorraad in zijn antwoord staan — zonder dat er ergens een
rechtencheck is overgeslagen. De bron was gewoon te breed.

De vragensteller ziet dus uitsluitend zijn eigen afdeling, en binnen die
afdeling niet dieper dan zijn rang: `me.categories` bepaalt of laag 2 überhaupt
mag rekenen, en de MCP snijdt daar elk zwaarder veld weg.

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

### Hoe laag 2 aan een cijfer komt

In twee fasen, en die scheiding is de hele veiligheid:

1. **Kiezen.** Het model krijgt de catalogus van beschikbare aggregaties en zegt
   welke het wil, met welke argumenten. Meer niet.
2. **Rekenen.** De MCP voert die aggregatie uit en geeft het getal terug mét
   verantwoording. Het resultaat wordt een gewone bron, waarna het bestaande
   antwoordpad van laag 1 het overneemt — inclusief de controle dat elk getal in
   het antwoord uit een bron komt.

Het model kiest dus wélke aggregatie zinvol is en interpreteert de uitkomst; het
rekent nergens. Een tool-use-lus waarin het model zelf tools aanroept zou dat
vervagen — nu is er letterlijk geen pad waarlangs een door het model bedacht
getal het antwoord in komt.

**Bestaat de gevraagde aggregatie niet, dan weigert hij.** Niet schatten, en niet
een andere pakken die er ongeveer op lijkt. Die toets staat in code en niet in de
prompt: een model dat wordt gevraagd niet te verzinnen, verzint soms toch.

Ook een weigering: een vraag zonder periode. Een cijfer zonder periode zegt niets.

### Het cijfer met zijn verantwoording

Elk cijfer wordt getoond mét periode, populatie, definitie en uitgesloten
records — **standaard zichtbaar, niet uitklapbaar**. Dat leest zwaarder. Doe het
toch: wat achter een klik zit wordt niet gelezen en dus ook niet meegenomen naar
de vergadering waar dat getal gebruikt wordt.

Valt de verantwoording weg door de veldclassificatie (de vragensteller mag de
populatie of definitie niet zien), dan weigert de assistent het cijfer helemaal.
Een getal zonder controle is precies wat de briefing verbiedt.

## Wat er nog niet in zit

- **Alleen bij een openstaand voorstel.** Het paneel hangt aan de itempagina. Een
  invoerveld zonder open item — met de werkbak als context — is de logische
  volgende stap nu laag 2 er is: een vraag over klachtenpercentages hoort niet
  aan één mail te hangen.
- **De catalogus is handmatig.** `AGGREGATION_CATALOG` in
  `ui/lib/assistant/analyse-run.ts` beschrijft wat het model mag kiezen. De
  namen komen uit de MCP's, de omschrijvingen niet — zodra een derde MCP
  aggregaties aanbiedt hoort dit uit de MCP zelf te komen, want een omschrijving
  die hier veroudert laat het model de verkeerde kiezen.
- **Twee aggregaties.** Hoeveel er standaard in gaan is een open besluit uit de
  briefing.
- **Geen geheugen tussen vragen.** Elke vraag staat op zichzelf. Dat houdt de
  controle eerlijk: er is geen eerdere beurt waaruit een bewering kan lekken die
  niet meer in de bronnen staat.

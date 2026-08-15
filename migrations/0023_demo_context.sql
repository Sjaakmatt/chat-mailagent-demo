-- 0023_demo_context
--
-- De inhoudelijke context voor de Factum Webshop-demo: één beleidsregel per
-- categorie uit `packages/agent-core/src/taxonomy/index.ts`.
--
-- Twee blokken, in deze volgorde:
--   A. De winkel — levering, retour, garantie, producten, betaling. Dit is het
--      echte werk en dit is wat een prospect beoordeelt.
--   B. FactumAI — de mailagent, de chatbot, prijzen, beveiliging. De bezoeker
--      op deze winkel is vaak een prospect; die vragen komen gegarandeerd.
--
-- ## Waarom beleidsregels en geen memory-entries
--
-- De agent leest `aios_policy_rules` op categorie en injecteert
-- `response_directive` letterlijk in de plan-prompt (zie `steps.ts`). Dat werkt
-- vandaag, zonder extra configuratie. Memory-entries (`aios_memory_entries`)
-- zijn de rijkere route, maar die vereisen `AIOS_RAG_ENABLED=true` plus een
-- `VOYAGE_API_KEY` voor de embeddings — staat allebei uit. Zolang dat zo is,
-- zou kennis in memory nooit worden opgehaald.
--
-- De directive telt bovendien mee als **vertrouwde brontekst** voor de
-- grounding-check (`steps.ts`: `trustedText`). Getallen die hier staan — een
-- retourtermijn, een verzendtarief — mag de agent dus noemen zonder dat de
-- grounding-check ze als verzonnen markeert. Dat is precies waarom ze hier
-- horen en niet in een prompt.
--
-- ## Eén regel per categorie, en waarom dat moet
--
-- `selectPolicyRule()` doet `rules.find(...)` op `priority.asc` en pakt dus de
-- EERSTE match. Een tweede regel op dezelfde categorie wordt stil genegeerd.
-- Vandaar: één regel per slug, en de priority alleen om de volgorde in de
-- cockpit netjes te houden.
--
-- ## LET OP — de cijfers hieronder zijn verzonnen
--
-- Bedragen, termijnen, specificaties, tarieven en resultaatpercentages zijn
-- ingevuld om de demo te laten praten, niet omdat ze kloppen. Wat wél
-- vastligt en dus consistent moet blijven:
--   * `migrations/0005_demo_testdata.sql` — orders DEMO-1001/1002/1003 en de
--     artikelen DEMO-SKU-A/B/C met hun prijzen en voorraad;
--   * `factum-webshop/public/index.html` en `klantenservice.html` — de FAQ die
--     de bezoeker naast de chat ziet staan.
-- Wijzig je hier een getal, wijzig het daar mee. Een chatbot die iets anders
-- zegt dan de pagina eronder, is erger dan geen chatbot.
--
-- Dollar-quoting (`$ctx$`) zodat apostrofs in de tekst niet ontsnapt hoeven te
-- worden. Idempotent: opnieuw draaien werkt de teksten bij zonder te dupliceren.

insert into public.aios_policy_rules
  (id, organization_id, name, description, applies_to, response_directive,
   priority, enabled, action, creates_task)
values

-- ===========================================================================
-- A. DE WINKEL
-- ===========================================================================

-- ---------------------------------------------------------------------------
('pol_levertijd', 'org_factumai_internal',
 'Levertijd en orderstatus',
 'Waar is mijn bestelling — status, track & trace, verwachte bezorging.',
 array['levertijd_status'],
 $ctx$Onderwerp: de status van een lopende bestelling.

Werk altijd vanaf de opgehaalde ordergegevens. Noem geen datum, status of
track & trace-code die niet uit de lookup komt. Kwam er niets terug, zeg dan
dat je het ordernummer niet kunt vinden en vraag om het ordernummer zoals het
in de bevestigingsmail staat (formaat DEMO-1234).

Vertaal de statuscode naar mensentaal:
- pending    = besteld, nog niet ingepakt. Wordt op werkdagen dezelfde dag of
               de volgende ochtend verzendklaar gemaakt.
- shipped    = onderweg. Noem de vervoerder en de track & trace-code, en de
               verwachte bezorgdag als die in de tracking staat.
- delivered  = afgeleverd. Noem wanneer en waar volgens de tracking. Zegt de
               klant dat hij het niet heeft ontvangen, dan is dat geen
               levertijdvraag meer maar een bezorgprobleem.

Vaste kaders die je mag noemen:
- Op voorraad en voor 23:00 besteld op een werkdag = de volgende werkdag in
  huis. Zaterdag besteld = maandag verwerkt.
- PostNL bezorgt op werkdagen tussen 08:00 en 21:30. Track & trace komt
  automatisch per mail zodra het pakket is overgedragen.
- Een pakket dat volgens de tracking langer dan 48 uur niet is bewogen,
  behandelen we als vermist; dat is een taak voor een mens, geen geruststelling.

Beloof nooit een preciezere bezorging dan de tracking zegt. "Morgen in huis"
alleen als de tracking dat expliciet aangeeft.$ctx$,
 10, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_voorraad', 'org_factumai_internal',
 'Voorraad en beschikbaarheid',
 'Is dit artikel er, en zo niet: wanneer weer.',
 array['voorraad_beschikbaarheid'],
 $ctx$Onderwerp: beschikbaarheid van een artikel dat nog niet besteld is.

Dit gaat over de voorraadlookup, niet over een order. Vraagt iemand naar een
artikel bij een bestaand ordernummer, dan is het een levertijdvraag.

Wat er nu in het assortiment staat:
- Monitorarm Dual 27 inch (DEMO-SKU-A) — 149,00 euro, ruim op voorraad,
  levertijd 2 werkdagen.
- Bureaulamp Lumen (DEMO-SKU-B) — 89,00 euro, tijdelijk uitverkocht,
  verwachte levertijd 14 dagen.
- Zit-sta bureaublad 120x70 (DEMO-SKU-C) — 249,00 euro, beperkte voorraad,
  levertijd 5 werkdagen.

Noem het aantal stuks alleen als de lookup het teruggeeft, en zeg het dan
neutraal ("nog een handvol op voorraad") in plaats van een exact getal — dat
verschuift per uur en een verkeerd aantal wordt tegen ons gebruikt.

Is iets uitverkocht:
- Noem de verwachte levertijd, en zeg erbij dat het een verwachting is van de
  leverancier en geen toezegging.
- Bestellen kan gewoon door; het artikel wordt verzonden zodra het binnen is.
- Bied aan om een seintje te sturen zodra het weer op voorraad is. Dat is een
  actie, dus daar komt een mens aan te pas — beloof niet dat het al geregeld is.

Verzin geen alternatieven of vervangende artikelen buiten de drie hierboven.$ctx$,
 20, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_verzending', 'org_factumai_internal',
 'Verzending, tarieven en bezorgopties',
 'Verzendkosten, buitenland, bezorgopties, afhalen.',
 array['verzending_tarieven'],
 $ctx$Onderwerp: verzendkosten en bezorgopties.

De tarieven:
- Nederland: 4,95 euro, gratis vanaf 50,00 euro ordertotaal.
- België en Luxemburg: 7,95 euro, gratis vanaf 75,00 euro.
- Daarbuiten leveren we niet. Zeg dat rechtstreeks en verwijs niet naar een
  omweg via een doorstuurdienst — daar geven we geen garantie op.

Opties bij het afrekenen:
- Bezorging op een PostNL-pakketpunt.
- Bezorgen op een ander adres dan het factuuradres.
- Avondbezorging (18:00-21:30) tegen 2,50 euro extra, alleen in Nederland.
- Afhalen kan niet: we hebben geen winkel, alleen een magazijn.

Het zit-sta bureaublad gaat als pakket, niet als pallet; er is geen montage- of
installatiedienst. Zeg dat erbij als iemand naar bezorging "tot in de kamer"
of montage vraagt.

Buitenland: prijzen zijn inclusief 21 procent Nederlandse btw. Voor zakelijke
klanten in Belgie of Luxemburg met een geldig btw-nummer verleggen we de btw;
dat regelt een medewerker handmatig, dus dat wordt een taak.$ctx$,
 30, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_orderwijziging', 'org_factumai_internal',
 'Bestelling wijzigen of annuleren',
 'Adres, aantal, annuleren — alleen zolang het pakket nog niet weg is.',
 array['order_wijziging'],
 $ctx$Onderwerp: een bestelling wijzigen, aanvullen of annuleren.

De harde grens: wijzigen kan zolang de order nog niet is overgedragen aan de
vervoerder. Kijk dus eerst naar de status uit de lookup.
- pending  = wijzigen kan waarschijnlijk nog. Zeg "waarschijnlijk", niet
             "zeker": tussen jouw antwoord en de handeling zit het magazijn.
- shipped  = te laat. Het pakket is onderweg. De route is dan: weigeren bij de
             deur, of aannemen en binnen 30 dagen retourneren.
- delivered = wijzigen is niet meer aan de orde; dit wordt een retour.

Dit is altijd een handeling en dus nooit iets wat je zelf afrondt. Bevestig wat
je hebt begrepen — welk ordernummer, wat er precies moet veranderen — en zeg
dat een medewerker het doorvoert en bevestigt. Zeg niet "ik heb het aangepast".

Wat we wel en niet kunnen wijzigen:
- Bezorgadres binnen Nederland: ja, zolang de order pending is.
- Aantal verlagen of een artikel schrappen: ja, het verschil wordt
  teruggestort op dezelfde betaalmethode.
- Artikel toevoegen: nee. Dat wordt een nieuwe bestelling; verzendkosten van
  de eerste order worden dan niet verrekend.
- Land wijzigen na betaling: nee, dat raakt de btw. Annuleren en opnieuw
  bestellen.

Bij annuleren: volledig terugbetaald binnen 14 dagen, inclusief verzendkosten,
op dezelfde betaalmethode.$ctx$,
 40, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_retour', 'org_factumai_internal',
 'Retour, ruilen en terugbetaling',
 'Herroepingsrecht, retourvoorwaarden, terugbetaaltermijn.',
 array['retour_ruilen'],
 $ctx$Onderwerp: retourneren, ruilen of terugbetaling.

De voorwaarden, en houd je hier letterlijk aan — ze staan ook in de FAQ op de
site en mogen daar niet van afwijken:
- 30 dagen bedenktijd vanaf de dag van ontvangst. Ruimer dan de wettelijke 14
  dagen; dat mag je noemen als het gesprek daarover gaat.
- Het product mag uitgepakt en geprobeerd zijn. Beoordelen mag, gebruiken niet:
  het moet compleet en onbeschadigd terugkomen, met alle onderdelen,
  schroefjes en de handleiding.
- Terugbetaling binnen 14 dagen nadat wij de retour hebben ontvangen en
  gecontroleerd, via dezelfde betaalmethode als bij de bestelling.
- De heenverzendkosten krijg je terug bij een volledige retour, niet bij een
  gedeeltelijke.
- Het retourlabel is gratis binnen Nederland. Vanuit Belgie en Luxemburg
  rekenen we 5,95 euro, verrekend met de terugbetaling.
- Retouradres staat op het label; stuur nooit iets op eigen initiatief terug
  zonder aangemeld te hebben, want dan kunnen we het niet koppelen.

Ruilen doen we niet als aparte route: het gaat als retour plus een nieuwe
bestelling. Dat is sneller en de klant heeft zijn geld eerder terug.

Twee dingen die niet retour kunnen: een artikel dat op maat of op bestelling is
gemaakt, en een artikel dat zichtbaar gemonteerd en gebruikt is (krassen op het
onderstel, boorgaten in het blad).

Een retour aanmelden is een handeling. Vraag om het ordernummer en welk artikel
het betreft, bevestig de voorwaarden, en zeg dat een medewerker het retourlabel
klaarzet en per mail stuurt. Zeg niet dat het label onderweg is.$ctx$,
 50, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_garantie', 'org_factumai_internal',
 'Garantie en defecten',
 'Twee jaar garantie, wat er wel en niet onder valt, hoe het loopt.',
 array['garantie_claim'],
 $ctx$Onderwerp: garantie of een defect product.

De kaders:
- Twee jaar garantie op alle artikelen, vanaf de factuurdatum. Op de motoren
  van het zit-sta-onderstel geldt vijf jaar.
- Gaat er binnen die termijn iets stuk bij normaal gebruik, dan repareren of
  vervangen we het kosteloos, inclusief verzending heen en terug. Lukt geen van
  beide, dan betalen we terug.
- Wettelijke conformiteit staat los van en boven deze garantie. Zeg nooit dat
  de rechten van de klant na twee jaar vervallen — dat is onjuist en het is
  precies het soort uitspraak waar we op afgerekend worden.

Wat er niet onder valt: schade door vallen, stoten of vocht, normale slijtage
(krassen, verkleuring), en schade door verkeerde montage of overbelasting
(bijvoorbeeld meer dan 80 kg op het zit-sta-blad, of schermen zwaarder dan 8 kg
per monitorarm).

Hoe je het gesprek voert:
1. Vraag om het ordernummer en om een korte beschrijving van wat er misgaat.
2. Vraag om een foto of een kort filmpje. Dat versnelt het echt en het is de
   enige manier waarop een collega het zonder heen-en-weer kan beoordelen.
3. Zeg dat een medewerker de claim beoordeelt en binnen twee werkdagen laat
   weten of het een reparatie, een vervanging of een terugbetaling wordt.

Beoordeel de claim niet zelf en zeg nooit toe dat er vervangen wordt. Toon
begrip zonder schuld te erkennen namens het bedrijf.$ctx$,
 60, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_bezorgprobleem', 'org_factumai_internal',
 'Bezorgprobleem',
 'Pakket niet aangekomen, beschadigd binnengekomen, verkeerd geleverd.',
 array['bezorgprobleem'],
 $ctx$Onderwerp: er is iets misgegaan bij de bezorging.

Dit is losgehouden van garantie, want het ligt bij de vervoerder en het loopt
anders. Drie varianten:

1. Niet aangekomen, tracking zegt onderweg. Kijk naar de laatste
   tracking-gebeurtenis en noem die. Minder dan 48 uur stil: vraag om nog een
   werkdag geduld. Langer stil: melden als vermist, dat doet een medewerker.
2. Tracking zegt afgeleverd, klant heeft niets. Vraag of er bij de buren is
   gekeken en of er een bericht in de brievenbus lag; PostNL levert regelmatig
   bij de buren af zonder dat de tracking dat toont. Blijft het weg, dan doen
   wij navraag bij de vervoerder en sturen we opnieuw of betalen we terug.
   Beloof geen van beide zelf.
3. Beschadigd of verkeerd geleverd. Vraag om een foto van het artikel en van
   de verpakking, en meld dat we het kosteloos oplossen. Het beschadigde
   artikel mag de klant houden tot wij hebben laten weten wat ermee moet.

In alle drie de gevallen: dit wordt een taak voor een mens. Bevestig het
ordernummer en wat er speelt, en zeg wat de klant kan verwachten en wanneer —
binnen een werkdag bericht.

Wees hier expliciet excuserend over het ongemak, zonder aansprakelijkheid te
erkennen of een vergoeding toe te zeggen.$ctx$,
 70, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_product', 'org_factumai_internal',
 'Productvragen en advies',
 'Maten, materialen, compatibiliteit, montage, gebruik.',
 array['product_vraag'],
 $ctx$Onderwerp: een inhoudelijke vraag over een artikel.

Hieronder staat wat we van de drie artikelen weten. Staat iets er niet bij,
dan verzin je het niet: zeg dat je het navraagt en laat een medewerker
antwoorden. Een verkeerde maat of een verkeerd draagvermogen leidt tot een
retour en soms tot schade.

MONITORARM DUAL 27 INCH (DEMO-SKU-A) — 149,00 euro
- Twee armen, voor schermen tot 27 inch en maximaal 8 kg per arm.
- VESA 75x75 en 100x100. Zonder VESA-gaten past het niet; er is geen adapter.
- Bureaubladklem tot 85 mm dik, en een doorvoertule voor een gat in het blad.
- In hoogte verstelbaar over 45 cm, kantelen, draaien en pivot (staand scherm).
- Kabelgeleiding door de arm. Aluminium, mat zwart, 4,2 kg.
- Montage zonder gereedschap, ongeveer 10 minuten.

BUREAULAMP LUMEN (DEMO-SKU-B) — 89,00 euro
- Led, 12 watt, ongeveer 600 lumen, kleurweergave CRI boven 90.
- Traploos dimbaar, kleurtemperatuur instelbaar van 2700 K warm tot 6500 K koel.
- Touchbediening die de laatste stand onthoudt.
- Usb-c-uitgang van 18 watt om een telefoon naast je werk te laden.
- Zowel een voet als een tafelklem meegeleverd. Zwart of wit.
- Op dit moment uitverkocht, verwachte levertijd 14 dagen.

ZIT-STA BUREAUBLAD 120x70 (DEMO-SKU-C) — 249,00 euro
- Blad 120 bij 70 cm, 25 mm dik, eikenfineer op een kern van spaanplaat.
- Elektrisch onderstel met twee motoren, in hoogte van 62 tot 128 cm.
- Draagvermogen 80 kg inclusief het blad zelf.
- Vier geheugenstanden en botsdetectie die stopt bij weerstand.
- Kabelgoot onder het blad meegeleverd.
- Kleuren: eiken, wit, antraciet.
- Montage met de meegeleverde inbussleutel, ongeveer 30 minuten, met z'n
  tweeen makkelijker vanwege het gewicht.

Vraagt iemand om advies tussen twee artikelen: mag je geven, op basis van deze
specificaties. Geen aanbevelingen op basis van smaak, en geen vergelijkingen
met merken die wij niet verkopen.

Handleidingen zijn als pdf beschikbaar; die stuurt een medewerker toe.$ctx$,
 80, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_technisch', 'org_factumai_internal',
 'Technisch probleem bij gebruik',
 'Het product doet het niet zoals verwacht — eerst uitsluiten, dan pas claimen.',
 array['technisch_probleem'],
 $ctx$Onderwerp: het artikel werkt niet zoals verwacht.

Onderscheid dit van een garantieclaim: hier is nog niet vastgesteld dat er iets
stuk is. Loop eerst de bekende oorzaken langs — in de praktijk lost dat het
merendeel op zonder retour.

Zit-sta-bureaublad dat niet omhoog of omlaag wil:
- Het onderstel moet na montage eenmalig worden gereset: houd de omlaag-knop
  vijf seconden ingedrukt tot het blad kort zakt en weer stijgt.
- Botsdetectie die te vroeg afgaat komt bijna altijd door een kabel of een
  ladeblok dat klem loopt.
- Knippert het display een code, vraag dan welke code; die zegt precies wat er
  aan de hand is.

Monitorarm die zakt of niet blijft staan:
- De veerspanning moet op het gewicht van het scherm worden gezet met de
  inbussleutel; uit de doos staat hij op ongeveer 4 kg.
- Klem los? De klem moet op een vlak deel van het blad zitten, niet op een rand
  of een afgeronde kant.

Bureaulamp die niet dimt of niet oplaadt:
- De touchstrip reageert niet door een hoes of een handschoen heen.
- De usb-c-uitgang levert 18 watt; een laptop die 45 watt vraagt, laadt niet.

Helpt niets van dit alles, dan behandel je het verder als een garantieclaim:
foto of filmpje vragen en doorzetten naar een medewerker.$ctx$,
 90, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_facturatie', 'org_factumai_internal',
 'Facturatie en betaling',
 'Betaalmethoden, facturen, btw, zakelijk bestellen.',
 array['facturatie'],
 $ctx$Onderwerp: betalen, facturen en btw.

Betaalmethoden: iDEAL, creditcard (Visa en Mastercard), PayPal, Apple Pay, en
Bancontact voor Belgie. Zakelijke klanten kunnen vanaf 250,00 euro op rekening
bestellen met een betaaltermijn van 14 dagen; dat moet eenmalig worden
goedgekeurd en dat doet een medewerker.

Facturen:
- De factuur gaat automatisch per mail zodra de bestelling is verzonden, naar
  het mailadres van de bestelling.
- Een kopie of een factuur op een andere tenaamstelling kan; dat is een
  handeling voor een medewerker. Een adreswijziging achteraf op een reeds
  verzonden factuur kan alleen met een creditnota.
- Prijzen op de site zijn inclusief 21 procent btw. Op de factuur staat het
  bedrag exclusief btw en het btw-bedrag apart.

Betaling mislukt of dubbel afgeschreven:
- Een dubbele afschrijving is bijna altijd een reservering die vanzelf binnen
  vijf werkdagen vervalt. Zeg dat, en zeg erbij dat een medewerker het
  controleert als het langer duurt.
- Een mislukte iDEAL-betaling waarbij het geld wel weg is, komt binnen twee
  werkdagen automatisch terug. Wordt er niets teruggestort, dan is dat een taak.

Doe zelf nooit een toezegging over terugstorten, kwijtschelden of een korting.
Noem geen bedragen die niet uit de ordergegevens of uit deze regels komen.$ctx$,
 100, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_klacht', 'org_factumai_internal',
 'Klacht',
 'Ontevreden over product, bezorging of afhandeling. Erkennen, niet oplossen.',
 array['klacht'],
 $ctx$Onderwerp: een klacht.

Hier telt de toon zwaarder dan de inhoud. Wat de klacht ook is, doe drie dingen
en in deze volgorde:
1. Erken wat er is gebeurd, in de woorden van de klant, zonder te bagatelliseren
   en zonder "helaas" of "excuses voor het ongemak" als opvulzin.
2. Geef de feiten die je hebt opgehaald. Alleen die. Een klacht die met een
   verkeerd feit wordt beantwoord, wordt twee klachten.
3. Zeg wat er nu gebeurt en wanneer de klant iets hoort. Binnen een werkdag,
   van een collega, per mail.

Wat je niet doet:
- De klant tegenspreken over wat hij heeft ervaren, ook niet als de gegevens
  iets anders laten zien. Noem de gegevens, trek geen conclusie.
- Aansprakelijkheid erkennen, een vergoeding, korting of coulance toezeggen.
  Dat is een beslissing van een mens, en die beslissing wordt makkelijker als
  wij hem niet al hebben weggegeven.
- Uitleggen hoe onze processen in elkaar zitten. Dat leest als een excuus.

Bij dreigende taal, een advocaat, de geschillencommissie of sociale media:
niet inhoudelijk reageren, alleen bevestigen dat het bericht is ontvangen en
dat een medewerker contact opneemt. Dit gaat altijd langs een mens.$ctx$,
 110, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_commercieel', 'org_factumai_internal',
 'Commercieel en zakelijk',
 'Grotere aantallen, offerte, wederverkoop, samenwerking.',
 array['commercieel'],
 $ctx$Onderwerp: een zakelijke of commerciele vraag over de winkel — meerdere
werkplekken inrichten, een offerte, wederverkoop, een samenwerking.

Dit is waardevol en het gaat altijd naar een mens. Wat je wel doet: interesse
tonen, de juiste dingen uitvragen, en een verwachting scheppen.

Vraag uit, zonder een verhoor te houden:
- Om hoeveel werkplekken of stuks gaat het?
- Welke artikelen, en wanneer moet het er zijn?
- Bedrijfsnaam en op welk adres het geleverd moet worden.

Wat je mag noemen:
- Vanaf 10 stuks maken we een offerte op maat; staffelkorting bespreken we dan.
- Zakelijk bestellen kan op rekening vanaf 250,00 euro, na eenmalige
  goedkeuring, met een betaaltermijn van 14 dagen.
- Levering van grotere aantallen loopt in overleg, niet via de standaard
  levertijden op de site.

Noem geen kortingspercentages en geen prijzen buiten de vaste stuksprijzen.
Zeg dat een collega binnen een werkdag contact opneemt.$ctx$,
 120, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_gdpr', 'org_factumai_internal',
 'Privacy- en AVG-verzoek',
 'Inzage, verwijdering, uitschrijven. Formeel, kort, altijd naar een mens.',
 array['gdpr_verzoek'],
 $ctx$Onderwerp: een AVG-verzoek van een betrokkene over zijn eigen gegevens —
inzage, correctie, verwijdering, bezwaar, of uitschrijven van de nieuwsbrief.

Dit is een formeel verzoek met een wettelijke termijn, geen servicevraag.
Behandel het strak en kort.

Wat je doet:
- Bevestig dat het verzoek is ontvangen en waar het volgens jou over gaat.
- Noem de termijn: binnen 30 dagen inhoudelijk antwoord, meestal sneller.
- Zeg dat een medewerker het verzoek behandelt en dat er om een bevestiging
  van de identiteit gevraagd kan worden.

Wat je nooit doet:
- Persoonsgegevens tonen, samenvatten of bevestigen — ook niet gegevens die de
  verzoeker zelf noemt. Niet bevestigen dat een adres of order bij ons bekend
  is. Dat is zelf al een verstrekking.
- Zeggen dat gegevens zijn of worden verwijderd. Dat kun jij niet vaststellen,
  en een deel mag wettelijk niet weg: facturen bewaren we zeven jaar voor de
  Belastingdienst. Noem die uitzondering feitelijk, niet als tegenwerping.
- Het verzoek beoordelen of afwijzen.

Uitschrijven van de nieuwsbrief hoort hier ook: bevestig het verzoek en zeg dat
het wordt doorgevoerd, niet dat het al gedaan is.

Toon: zakelijk en beknopt. Geen verkooppraat, geen aanbod om te helpen met iets
anders.$ctx$,
 130, true, 'review_queue', false),

-- ===========================================================================
-- B. FACTUMAI — schrappen bij een echte klant
-- ===========================================================================

-- ---------------------------------------------------------------------------
('pol_fai_mailagent', 'org_factumai_internal',
 'FactumAI — mailagent uitleggen',
 'Wat de mailagent doet en waar de mens in de lus zit.',
 array['factumai_mailagent'],
 $ctx$Onderwerp: de FactumAI-mailagent.

Wat hij doet, in deze volgorde: hij leest binnenkomende klantenservicemail uit
de mailbox van de klant, bepaalt waar de mail over gaat, zoekt de feiten op in
de bronsystemen (order, klant, voorraad, factuur), en schrijft een
conceptantwoord. Dat concept komt in de werkbak te staan. Een medewerker keurt
goed, past aan of wijst af; pas na goedkeuring gaat de mail eruit.

Benadruk dat de agent NOOIT zelfstandig naar een externe klant mailt. Dat is
geen instelling die je aan of uit zet, het zit in de architectuur: elke
uitgaande actie loopt via een ReviewItem. Dit is meestal het punt waar een
prospect over twijfelt, dus zeg het expliciet.

Twee dingen die hem onderscheiden en die je mag noemen:
- Grounding: elke feitelijke bewering in een concept — een bedrag, een datum,
  een status — moet terug te voeren zijn op een antwoord uit een bronsysteem in
  diezelfde run. Is er geen dekking, dan laat de agent de bewering weg in
  plaats van iets aannemelijks te verzinnen.
- Leren van correcties: wat een medewerker aanpast voor verzending wordt
  bewaard als signaal. Dat stuurt de agent bij op de manier waarop dit bedrijf
  schrijft.

Na afhandeling ruimt hij de mailbox op: de mail krijgt een label en gaat naar
een afgehandeld-map, zodat het team ziet wat de agent heeft gedaan.

Noem geen doorlooptijden of percentages tenzij de bezoeker daarnaar vraagt —
dan hoort dat bij de categorie resultaat.$ctx$,
 200, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_fai_chatbot', 'org_factumai_internal',
 'FactumAI — chatbot uitleggen',
 'Wat de chatwidget doet, en waar de grens ligt tussen antwoorden en een ticket.',
 array['factumai_chatbot'],
 $ctx$Onderwerp: de FactumAI-chatbot — de widget waar dit gesprek in plaatsvindt.

Je mag hiernaar verwijzen als naar jezelf, en dat werkt goed: de bezoeker ziet
het live. Wat je uitlegt:

- De chatbot beantwoordt direct wat uit de kennisbasis of uit een bronsysteem
  komt: verzendkosten, retourtermijn, orderstatus, track & trace. Dat zijn de
  twee toegestane uitkomsten op chat.
- Alles wat een handeling vraagt — een retour, een wijziging, een klacht —
  wordt een ticket. De bezoeker krijgt een bevestiging, een mens pakt het op.
  De chatbot doet die handeling niet zelf.
- Voor een systeemantwoord moet de bezoeker geidentificeerd zijn: mailadres en
  ordernummer. Zonder die twee geen ordergegevens, hoe stellig er ook naar
  gevraagd wordt. Op mail ligt dat anders, want daar staat het afzenderadres
  vast en gaat er hoe dan ook een mens overheen.
- Er zit een domeingrens voor: een vraag die niet over deze winkel of over
  FactumAI gaat, wordt niet beantwoord. Ook niet als het model het antwoord
  weet. De afwijzing is een vaste tekst, geen door het model geschreven zin.

De widget is een script van een regel op de pagina, in een iframe, met een
eigen kleur, titel en begroeting. Er is geen koppeling met de rest van de site
nodig.

Vraagt iemand of het gesprek wordt bewaard: ja, in de werkbak van de klant, zodat
een medewerker het gesprek kan terugzien en overnemen.$ctx$,
 210, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_fai_werkwijze', 'org_factumai_internal',
 'FactumAI — werkwijze en platform',
 'Hoe de lus werkt, van signaal tot goedgekeurde actie.',
 array['factumai_werkwijze'],
 $ctx$Onderwerp: hoe het onder water werkt.

Leg de lus uit in gewone taal, niet als architectuurplaat:

Er komt een signaal binnen — een mail of een chatbericht. De agent bepaalt
eerst of het uberhaupt over dit bedrijf gaat. Daarna wat het onderwerp is en
wie de klant is. Dan haalt hij de feiten op uit de systemen die eronder hangen.
Met die feiten schrijft hij een concept, en dat concept wordt gecontroleerd:
staat er een getal of een datum in die niet uit een van die systemen komt, dan
gaat het terug. Wat overblijft komt in de werkbak. Een medewerker keurt goed,
en pas dan gebeurt er iets naar buiten.

Wat je mag noemen als iemand doorvraagt:
- Het draait op Cloudflare en op een Supabase-database in Frankfurt. Geen
  eigen server bij de klant nodig.
- De werkbak is een webapplicatie waar het team in werkt: openstaande items,
  het originele bericht, het concept, de bronnen die zijn geraadpleegd, en een
  auditlog van elke beslissing.
- Elke uitgaande actie is idempotent en gelogd. Twee keer goedkeuren stuurt
  niet twee keer.
- Meerdere kanalen op dezelfde kern: mail en chat nu, andere kanalen haken op
  dezelfde lus aan.

Wat je niet doet: prompts, modelnamen of interne bestandsnamen delen, of
uitleggen hoe de agent te omzeilen zou zijn.$ctx$,
 220, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_fai_koppelingen', 'org_factumai_internal',
 'FactumAI — koppelingen en integraties',
 'Waar het op aansluit, en hoe we omgaan met een systeem dat we nog niet kennen.',
 array['factumai_koppelingen'],
 $ctx$Onderwerp: koppelingen met bestaande systemen.

Wat er vandaag staat:
- Mail: Microsoft 365 en Exchange Online via Graph. Gmail en Google Workspace.
- Webshop en ERP: WooCommerce, Shopify, Exact Online.
- CRM: HubSpot, Pipedrive.
- Agenda en plannen: Microsoft 365 en Google Agenda.
- Facturatie en betalingen: Stripe, Mollie.
- Verzending: PostNL, DHL.
- Overig: het Handelsregister van de KVK voor bedrijfsgegevens.

Hoe het werkt, en dit is het antwoord op de vraag achter de vraag: elke
koppeling is een aparte, afgeschermde service met een vaste set handelingen.
De agent vraagt "geef order X" en krijgt een antwoord; hij heeft geen
databasetoegang en geen inloggegevens. Die staan in een kluis en worden per
klant opgehaald door de koppeling zelf. Een koppeling die uitvalt laat de agent
niet vastlopen — het item gaat dan naar een mens, met de reden erbij.

Staat een systeem er niet bij: dat is normaal en meestal geen probleem, zolang
het een API of een export heeft. Een nieuwe koppeling bouwen we in de regel
binnen twee weken. Zeg niet dat "alles kan"; vraag welk systeem het is en zeg
dat een collega het concreet beoordeelt.

Alleen-lezen kan ook. Sommige klanten beginnen met alleen ophalen en zetten
schrijfacties er later pas op.$ctx$,
 230, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_fai_prijs', 'org_factumai_internal',
 'FactumAI — prijzen en voorwaarden',
 'Wat het kost, waar het van afhangt, en wanneer er een offerte aan te pas komt.',
 array['factumai_prijs'],
 $ctx$Onderwerp: wat het kost.

Wees hier concreet — ontwijken kost vertrouwen — maar zeg er altijd bij dat de
uiteindelijke prijs uit een offerte komt na een gesprek van een half uur.

De richtprijzen:
- Eenmalige inrichting vanaf 4.500 euro. Daarin zit de discovery, het inrichten
  van de categorieen en het beleid, twee standaardkoppelingen, de werkbak, en
  het meelopen tijdens de eerste weken.
- Mailagent: 750 euro per maand.
- Chatbot: 450 euro per maand.
- Allebei op dezelfde kern: 1.000 euro per maand.
- Een extra koppeling buiten de standaardset: 1.200 euro eenmalig.
- Alle bedragen zijn exclusief btw.

Wat erin zit: hosting, onderhoud, modelkosten bij normaal gebruik, updates aan
de kern, en support op werkdagen.

Waar het van afhangt: het aantal koppelingen, hoeveel maatwerk er in de
schermen zit, en het volume. Boven de 3.000 berichten per maand kijken we naar
de modelkosten; daaronder speelt het niet.

Voorwaarden: maandcontract na de eerste drie maanden, daarna maandelijks
opzegbaar. Geen opstartkosten die je kwijt bent als het niet bevalt — de
eerste maand is een proefperiode waarin je zonder kosten kunt stoppen.

Noem geen kortingen en onderhandel niet. Vraagt iemand om een scherpere prijs:
zeg dat daar een gesprek voor is en zet het door.$ctx$,
 240, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_fai_beveiliging', 'org_factumai_internal',
 'FactumAI — beveiliging, datalocatie en AVG',
 'Informatieve vraag van een prospect. Niet te verwarren met een AVG-verzoek.',
 array['factumai_beveiliging'],
 $ctx$Onderwerp: beveiliging, waar de data staat, en AVG.

Let op: dit is de informatieve vraag van iemand die overweegt klant te worden.
Gaat het over de eigen gegevens van de schrijver, dan is het een AVG-verzoek en
loopt het heel anders.

Wat je mag zeggen:
- Data staat in de Europese Unie. De database staat in Frankfurt, de
  verwerking loopt op Europese edge-locaties.
- Elke klant heeft zijn eigen omgeving en zijn eigen database. Gegevens van
  verschillende klanten komen niet bij elkaar; elke opvraging draagt de
  klantcontext mee en zonder die context komt er niets terug.
- Inloggegevens van gekoppelde systemen staan in een kluis, versleuteld, en
  zijn niet zichtbaar in de applicatie of in logbestanden.
- Er wordt niet getraind op klantdata. Berichten gaan naar de modelleverancier
  om het antwoord te maken en worden daar niet gebruikt om modellen te
  verbeteren.
- Er is een verwerkersovereenkomst. Een subverwerkerslijst is er ook; die
  stuurt een collega toe.
- Toegang tot de werkbak loopt via het account van de klant, met rollen: wie
  mag lezen, wie mag goedkeuren.
- Elke beslissing en elke goedkeuring wordt gelogd, met wie en wanneer.

Wat je niet doet: certificeringen claimen die we niet hebben (noem geen ISO- of
SOC-nummer), en geen uitspraken doen over de beveiliging van de systemen van de
prospect zelf. Vragen over een security-assessment of een pentest-rapport zet
je door naar een mens.$ctx$,
 250, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_fai_implementatie', 'org_factumai_internal',
 'FactumAI — implementatie',
 'Doorlooptijd, wat wij doen, wat de klant doet.',
 array['factumai_implementatie'],
 $ctx$Onderwerp: hoe een invoering eruitziet.

De vraag achter de vraag is bijna altijd: hoeveel werk is dit voor mijn team?
Antwoord daar expliciet op — het is minder dan mensen verwachten.

De stappen:
1. Kennismaking en discovery, ongeveer een dagdeel. We kijken mee in de mailbox
   en in de bestaande antwoorden, en bepalen welke onderwerpen er zijn.
2. Inrichten: categorieen, beleid per categorie, tone of voice, koppelingen.
   Dat doen wij, niet de klant. Dit is bewust: beleid dat de klant zelf invult
   wordt een rommeltje en dan werkt de agent slecht.
3. Meelopen: de agent draait mee zonder dat er iets uitgaat. Het team ziet de
   concepten en corrigeert. Ongeveer twee weken.
4. Live: de agent maakt concepten, het team keurt goed. Daarna sturen we bij op
   basis van de correcties.

Doorlooptijd: twee tot vier weken van eerste gesprek tot live, afhankelijk van
hoe snel de toegang tot de systemen geregeld is. Dat laatste is in de praktijk
het enige wat het vertraagt.

Wat de klant levert: toegang tot de mailbox en de systemen, iemand die
inhoudelijk beslist wat een goed antwoord is, en ongeveer twee uur per week
tijdens de meeloopfase.

Wat de klant niet hoeft: iets installeren, iets migreren, of iemand vrijmaken
om regels te onderhouden.$ctx$,
 260, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_fai_resultaat', 'org_factumai_internal',
 'FactumAI — resultaat en ROI',
 'Wat het oplevert. Voorzichtig met cijfers, expliciet over wat het niet doet.',
 array['factumai_resultaat'],
 $ctx$Onderwerp: wat het oplevert.

Wees hier eerlijker dan een verkoper zou zijn — dat overtuigt bij dit publiek
beter dan grote getallen.

Wat je mag noemen, als indicatie en niet als toezegging:
- Zeventig tot tachtig procent van de binnenkomende berichten krijgt een
  bruikbaar concept. De rest gaat blanco naar een mens.
- Behandeltijd per bericht gaat van ongeveer zes minuten naar ongeveer twee:
  lezen, controleren, versturen in plaats van uitzoeken en schrijven.
- De eerste reactie gaat sneller de deur uit, en de antwoorden worden
  eenduidiger doordat iedereen vanuit hetzelfde beleid werkt.

Wat het niet doet, en zeg dit uit jezelf:
- Het vervangt geen mensen. Er blijft iemand goedkeuren; dat is het ontwerp,
  niet een tijdelijke fase.
- Het lost geen rommelig proces op. Is niet duidelijk wat een goed antwoord is,
  dan wordt dat hier zichtbaar in plaats van opgelost.
- De eerste weken kost het tijd in plaats van dat het tijd oplevert.

Reken geen ROI uit met cijfers die de bezoeker niet zelf heeft genoemd. Noemt
hij wel volumes, dan mag je meerekenen — en zeg er dan bij dat het een
schatting is op zijn eigen getallen.$ctx$,
 270, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_fai_vergelijking', 'org_factumai_internal',
 'FactumAI — vergelijking met alternatieven',
 'Zelf bouwen, standaardchatbot, of niets doen. Nooit merken noemen.',
 array['factumai_vergelijking'],
 $ctx$Onderwerp: waarom dit en niet iets anders.

Noem nooit een concurrent bij naam en geef geen oordeel over een specifiek
ander product, ook niet als de bezoeker de naam zelf noemt. Praat over de
categorie.

Tegenover een standaardchatbot of een FAQ-bot: die beantwoordt vragen uit een
tekst. Deze agent kijkt in de systemen — de order, de voorraad, de factuur — en
mag alleen beweren wat daaruit terugkomt. En hij handelt af in plaats van door
te verwijzen: wat een handeling vraagt, wordt een ticket met de context er al
bij.

Tegenover zelf bouwen met een model en een paar API-koppelingen: dat werkt in
een demo. Wat het duur maakt is de rest — de mens in de lus, de controle op
verzonnen feiten, de logging, het scheiden van klantgegevens, en het feit dat
je het moet blijven onderhouden als een leverancier iets verandert. Wij hebben
dat een keer gebouwd en onderhouden het.

Tegenover niets doen: dat is een reeel alternatief bij lage volumes. Onder de
paar honderd berichten per maand verdient het zich niet terug. Zeg dat als het
zo is, in plaats van eromheen te praten.

Wat we niet doen en waar een ander beter is: volledig autonome afhandeling
zonder mens. Dat bouwen wij niet, ook niet op verzoek.$ctx$,
 280, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
('pol_fai_demo', 'org_factumai_internal',
 'FactumAI — demo of kennismaking',
 'Koopsignaal. Kort bevestigen, gegevens ophalen, naar een mens.',
 array['factumai_demo'],
 $ctx$Onderwerp: iemand wil een demo, een offerte of een gesprek.

Dit is het belangrijkste bericht dat er binnenkomt. Houd het kort en zorg dat
er een mens op zit.

Wat je doet:
- Bevestig enthousiast maar zakelijk dat het wordt opgepakt.
- Vraag om naam, bedrijf, mailadres, en in een zin waar het om gaat: welk
  kanaal (mail, chat of allebei) en welke systemen eronder hangen.
- Zeg dat een collega binnen een werkdag contact opneemt om een half uur in te
  plannen, en dat we in dat gesprek meekijken met echte berichten.

Wat je niet doet:
- Zelf een tijdstip afspreken of een agenda-uitnodiging beloven.
- Uitweiden over prijzen; die vraag heeft zijn eigen antwoord.
- Om meer gegevens vragen dan hierboven. Elke extra vraag kost antwoorden.

Wil de bezoeker eerst iets zien: hij zit al in de demo. Wijs erop dat hij deze
chat gerust mag testen met een moeilijke vraag, en dat de winkel eromheen een
demo-omgeving is met verzonnen bestellingen.$ctx$,
 290, true, 'review_queue', false),

-- ---------------------------------------------------------------------------
-- Vangnet
-- ---------------------------------------------------------------------------
('pol_overig', 'org_factumai_internal',
 'Overig',
 'Vangnet: past nergens onder of is niet duidelijk genoeg om op te handelen.',
 array['overig'],
 $ctx$Onderwerp: onduidelijk of past nergens onder.

Twee gevallen, en het onderscheid is belangrijk.

1. Het bericht is te vaag. "Ik heb een vraag", "kan iemand mij bellen", een
   losse begroeting. Stel dan een vraag terug, en maak die concreet: gaat het
   over een bestelling (en zo ja, welk ordernummer), over een product, of over
   iets anders? Een open "waarmee kan ik u helpen" levert nog een vaag bericht op.

2. Het onderwerp valt wel binnen het domein maar past onder geen enkele
   categorie. Bevestig dan wat je hebt begrepen en zeg dat een collega ernaar
   kijkt. Ga niet alsnog inhoudelijk antwoorden op iets waar geen beleid voor is.

Verzin in beide gevallen geen beleid en geen termijnen. Verwijs niet naar een
telefoonnummer; we zijn bereikbaar via de chat en per mail, op werkdagen tussen
09:00 en 17:30.

Blijft het onduidelijk na een keer doorvragen, dan gaat het naar een mens.$ctx$,
 900, true, 'review_queue', false)

on conflict (id) do update set
  organization_id    = excluded.organization_id,
  name               = excluded.name,
  description        = excluded.description,
  applies_to         = excluded.applies_to,
  response_directive = excluded.response_directive,
  priority           = excluded.priority,
  enabled            = excluded.enabled,
  action             = excluded.action,
  creates_task       = excluded.creates_task,
  updated_at         = now();

-- De eerdere FactumAI-only set droeg andere id's. Die zouden anders naast de
-- nieuwe regels blijven staan en via `priority.asc` de match kunnen kapen.
delete from public.aios_policy_rules
where organization_id = 'org_factumai_internal'
  and id in ('pol_mailagent', 'pol_chatbot', 'pol_werkwijze', 'pol_koppelingen',
             'pol_prijs', 'pol_beveiliging', 'pol_implementatie', 'pol_roi',
             'pol_vergelijking', 'pol_demo', 'pol_support', 'pol_privacy');

/**
 * De categorie-taxonomie van klantenservice — **het eerste bestand dat je per
 * klant aanpast.**
 *
 * Dit is de gedeelde woordenlijst van dit proces: de classifier kiest hieruit,
 * de beleidsregels matchen erop (als `klantenservice:<slug>`), en de cockpit
 * toont de labels. Agent-Worker én cockpit lezen dezelfde lijst via het pakket,
 * zodat een categorie nooit half doorgevoerd kan zijn.
 *
 * De set hieronder is een neutrale klantenservice-startset. Vervang 'm door de
 * taxonomie die uit de discovery van de klant komt — meestal 8 à 12 categorieën.
 * Vuistregel: een categorie verdient een eigen slug als er ánder beleid of een
 * andere specialist bij hoort. Anders hoort 'ie bij `overig`.
 *
 * Bij het toevoegen van een categorie:
 *   1. Zet 'm hieronder (slug + label + specialist + afbakening).
 *   2. Draai `pnpm -r test` en `pnpm eval:golden` — die bewaken de consistentie.
 *   3. Maak een beleidsregel in de cockpit die op de nieuwe categorie matcht.
 *
 * Gaat de nieuwe categorie over een ánder proces (een inkoopfactuur, een
 * offerte), dan hoort hij niet hier maar in de taxonomie van dát pakket.
 */

import type { CategoryDef } from '../../taxonomy/index.js';

/**
 * Taxonomie voor Factum Webshop — de winkel waarin FactumAI zijn eigen
 * modulaire AI- en softwareproducten verkoopt: agents, koppelingen, modules en
 * de diensten eromheen.
 *
 * ## Waarom dit één wereld is en geen twee
 *
 * Bij een gewone webshop staan het product en de leverancier los van elkaar:
 * de klant vraagt naar zijn bureaulamp, niet naar de winkel. Hier vallen ze
 * samen. "Wat doet de mailagent" is tegelijk een productvraag én een vraag over
 * wat wij verkopen, en het antwoord is hetzelfde. Een aparte set categorieën
 * voor "over ons" zou de classifier een keuze laten maken die geen verschil
 * maakt — en dat is precies hoe je een classifier onbetrouwbaar maakt.
 *
 * ## Waar de scheidslijnen wél liggen, en waarom
 *
 * - `levertijd_status` gaat over een **lopend traject** met een ordernummer
 *   (lookup in de bron); `beschikbaarheid` over een artikel dat iemand
 *   overweegt. Andere bron, ander antwoord, ander beleid.
 * - `storing_sla` is er iets stuk bij een bestaande klant; `technisch_probleem`
 *   is het werkt niet zoals verwacht en dat is meestal een instelling. Die
 *   eerste heeft een reactietermijn, de tweede een checklist.
 * - `opzegging_proef` (weg willen) staat los van `order_wijziging` (iets anders
 *   willen). Commercieel twee heel verschillende gesprekken.
 * - `gdpr_verzoek` is een verzoek van een betrokkene over zijn eigen gegevens;
 *   `beveiliging_avg` is een informatieve vraag van iemand die overweegt klant
 *   te worden. Op één hoop gooien levert een agent op die een inzageverzoek als
 *   verkooppraatje behandelt.
 *
 * Bij een klant in een ander vak vervang je deze lijst. De structuur — een
 * statusvraag, een productvraag, een wijziging, een opzegging, een storing, een
 * klacht, een privacyverzoek en een vangnet — blijft in de praktijk staan.
 */
export const KLANTENSERVICE_TAXONOMY: readonly CategoryDef[] = Object.freeze([
  // --- Oriënteren: iemand die nog niets heeft --------------------------
  { slug: 'product_vraag', label: 'Productvraag', specialist: 'simple_reply', hint: 'wat een artikel doet, kost of kan — ook als de bezoeker enthousiast klinkt. Dit is de standaard voor elke inhoudelijke vraag over het assortiment' },
  { slug: 'beschikbaarheid', label: 'Beschikbaarheid / levertijd', specialist: 'simple_reply', hint: 'kan ik dit krijgen en wanneer draait het; levertijd van een artikel dat nog niet is afgenomen' },
  { slug: 'koppelingen', label: 'Koppelingen', specialist: 'technical', hint: 'past dit op systeem X, is er een koppeling met Y, kan het op onze omgeving' },
  { slug: 'prijs_voorwaarden', label: 'Prijs / voorwaarden', specialist: 'simple_reply', hint: 'wat kost het, staffels, wat zit erin, contractduur, opzegtermijn' },
  { slug: 'werkwijze', label: 'Werkwijze / platform', specialist: 'simple_reply', hint: 'hoe werkt het onder water, gaat er een mens overheen, wat gebeurt er met een bericht' },
  { slug: 'implementatie', label: 'Implementatie', specialist: 'simple_reply', hint: 'hoe verloopt de invoering, hoe lang duurt het, wat moet ik zelf doen' },
  { slug: 'beveiliging_avg', label: 'Beveiliging / AVG', specialist: 'simple_reply', hint: 'waar staat de data, wordt er getraind op onze gegevens, verwerkersovereenkomst. NIET een verzoek over de eigen gegevens van de schrijver' },
  { slug: 'resultaat_roi', label: 'Resultaat / ROI', specialist: 'simple_reply', hint: 'wat levert het op, hoeveel tijd bespaart het, verdient het zich terug' },
  { slug: 'vergelijking', label: 'Vergelijking met alternatieven', specialist: 'simple_reply', hint: 'waarom dit en niet zelf bouwen of een bot van de plank' },
  { slug: 'offerte_aanvraag', label: 'Offerte', specialist: 'escalate', hint: 'ALLEEN als de bezoeker zelf om een offerte of prijsopgave vraagt, of een samenstelling voorlegt. Niet bij een gewone prijsvraag' },
  { slug: 'demo_aanvraag', label: 'Demo / kennismaking', specialist: 'escalate', hint: 'ALLEEN als de bezoeker zelf om een demo, gesprek, afspraak of terugbelverzoek vraagt. Interesse tonen in een product is dit NIET — dat is product_vraag' },

  // --- Klant zijn: iemand met een lopend traject of abonnement ---------
  { slug: 'levertijd_status', label: 'Status van je implementatie', specialist: 'simple_reply', hint: 'de stand van een lopend traject of bestelling, meestal met een ordernummer' },
  { slug: 'order_wijziging', label: 'Abonnement wijzigen', specialist: 'order_change', hint: 'iets erbij, eraf of anders op een bestaand abonnement of bestelling' },
  { slug: 'opzegging_proef', label: 'Opzeggen / proefperiode', specialist: 'order_change', hint: 'stoppen, opzeggen, geld terug, proefperiode' },
  { slug: 'storing_sla', label: 'Storing / SLA', specialist: 'complaint', hint: 'iets dat werkte doet het niet meer, bij een bestaande klant' },
  { slug: 'technisch_probleem', label: 'Technisch probleem', specialist: 'technical', hint: 'werkt niet zoals verwacht, maar er is nog niet vastgesteld dat er iets stuk is' },
  { slug: 'facturatie', label: 'Facturatie / betaling', specialist: 'simple_reply', hint: 'facturen, betaaltermijn, btw, tenaamstelling, betaling die niet klopt' },

  // --- Altijd apart ----------------------------------------------------
  { slug: 'klacht', label: 'Klacht', specialist: 'complaint', hint: 'ontevredenheid over een product, traject of afhandeling; boze of teleurgestelde toon' },
  { slug: 'commercieel', label: 'Zakelijk / partner', specialist: 'escalate', hint: 'wederverkoop, partnerschap, meerdere vestigingen of merken' },
  { slug: 'gdpr_verzoek', label: 'Privacy / AVG-verzoek', specialist: 'gdpr', hint: 'AVG-verzoek over de eigen gegevens van de schrijver: inzage, verwijdering, uitschrijven' },
  { slug: 'overig', label: 'Overig', specialist: 'escalate', hint: 'te vaag om te routeren, of past nergens onder. Bij een losse begroeting hoort dit, ook als er eerder in het gesprek iets anders speelde' },
]);

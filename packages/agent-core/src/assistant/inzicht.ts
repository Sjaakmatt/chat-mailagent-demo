/**
 * De werkbak in cijfers — wat de assistent aan een medewerker kan vertellen.
 *
 * ## Waarom dit bestaat
 *
 * De assistent kon uitleggen en verantwoorden, maar niet **overzicht geven**. En
 * dat is waar een medewerker in een werkbak naar vraagt: hoeveel klachten heeft
 * deze klant gedaan, hoeveel kwam er vandaag binnen, hoe vaak komt dit verzoek
 * terug, hoe vaak vraagt iemand waar zijn bestelling blijft. Zonder die cijfers
 * is het een raadpleegvenster bij één zaak in plaats van inzicht in het werk.
 *
 * ## Waarom hier geteld wordt en niet door het model
 *
 * Harde regel: **het model rekent niet.** Deze functies tellen deterministisch
 * en zetten het resultaat uitgeschreven in de brontekst; het model leest het en
 * citeert het. Daarmee dekt de bestaande grounding-controle de cijfers vanzelf —
 * een getal dat hier niet staat, haalt het antwoord niet.
 *
 * Dat is ook waarom de tellingen zijn **uitgeschreven** en niet samengevat. "12"
 * moet letterlijk in een bron staan voordat de assistent "12" mag zeggen.
 *
 * ## Waarom dit los staat van een module
 *
 * Er zit geen mailkennis in. Deze functies krijgen rijen aangeleverd en tellen;
 * wélke rijen bepaalt de module, en die geeft alleen zijn eigen werk mee. Een
 * tweede automatisering krijgt hetzelfde inzicht over zijn eigen bak zonder dat
 * hier iets aan verandert — precies de scheiding uit `docs/MODULES.md`.
 *
 * ## Verhouding tot laag 2
 *
 * Laag 2 rekent in de MCP over de bronsystemen (omzet, doorlooptijd bij de
 * vervoerder). Dit telt wat er dóór de werkbak ging. Andere vraag, andere bron,
 * en ze bijten elkaar niet: het aantal binnengekomen berichten staat nergens in
 * een ERP.
 */

import { makeSource, type AssistantSource } from './sources.js';

/**
 * Wat er van een afgehandeld bericht nodig is om te kunnen tellen.
 *
 * Bewust een eigen, kleine vorm en niet het rij-type van de cockpit: dan blijft
 * deze module runtime-agnostisch en testbaar zonder database. De cockpit-rij
 * voldoet er structureel aan.
 */
export interface InzichtRow {
  id: string;
  status: string;
  category: string | null;
  created_at: string;
  from_address: string | null;
  subject: string | null;
  /** Terugval als er geen onderwerp is — bij een chatbeurt is dat normaal. */
  summary?: string | null;
}

/** En van een ticket: alleen bij wie het hoort. */
export interface InzichtTicket {
  contactEmail?: string | null;
}

/** Hoeveel klanten er afzonderlijk worden uitgeschreven. */
const MAX_KLANTEN = 30;
/** Over hoeveel dagen de dagtelling loopt. */
const DAGEN = 14;
/** Hoeveel terugkerende onderwerpen er meegaan. */
const MAX_ONDERWERPEN = 15;

/** Het e-mailadres uit een `Naam <adres>`-kop, of de kop zelf. */
export function adresVan(from: string | null | undefined): string | null {
  if (!from) return null;
  const hoek = from.match(/<([^>]+)>/);
  const adres = (hoek ? hoek[1] : from).trim().toLowerCase();
  return adres.includes("@") ? adres : null;
}

/** yyyy-mm-dd van een timestamp. */
const dag = (iso: string): string => iso.slice(0, 10);

function tel<T>(items: readonly T[], sleutel: (i: T) => string | null): Map<string, number> {
  const uit = new Map<string, number>();
  for (const i of items) {
    const k = sleutel(i);
    if (k === null) continue;
    uit.set(k, (uit.get(k) ?? 0) + 1);
  }
  return uit;
}

const gesorteerd = (m: Map<string, number>): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/**
 * Volume: hoeveel er binnenkwam, wanneer, en waarover.
 *
 * De laatste veertien dagen staan per dag uitgeschreven omdat "hoeveel kwam er
 * vandaag binnen" en "was het gisteren drukker" allebei gewone vragen zijn, en
 * een model dat zelf uit datums moet optellen precies doet wat het niet mag.
 */
export function volumeSource(
  rows: readonly InzichtRow[],
  nu: Date,
): AssistantSource {
  const vandaag = nu.toISOString().slice(0, 10);
  const perDag = tel(rows, (r) => dag(r.created_at));
  const perCategorie = tel(rows, (r) => r.category ?? "geen categorie");
  const perStatus = tel(rows, (r) => r.status);

  const dagen: string[] = [];
  for (let i = 0; i < DAGEN; i++) {
    const d = new Date(nu.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    dagen.push(`- ${d}${d === vandaag ? " (vandaag)" : ""}: ${perDag.get(d) ?? 0}`);
  }

  const vandaagPerCategorie = tel(
    rows.filter((r) => dag(r.created_at) === vandaag),
    (r) => r.category ?? "geen categorie",
  );

  return makeSource({
    id: "inzicht:volume",
    kind: "werkvoorraad",
    label: "Volume en verdeling",
    href: "/analytics",
    text: [
      `Totaal aantal berichten in deze bak: ${rows.length}`,
      `Vandaag (${vandaag}) binnengekomen: ${perDag.get(vandaag) ?? 0}`,
      "",
      `Per dag, laatste ${DAGEN} dagen:`,
      ...dagen,
      "",
      "Vandaag per categorie:",
      ...(vandaagPerCategorie.size > 0
        ? gesorteerd(vandaagPerCategorie).map(([c, n]) => `- ${c}: ${n}`)
        : ["- niets binnengekomen vandaag"]),
      "",
      "Alles per categorie:",
      ...gesorteerd(perCategorie).map(([c, n]) => `- ${c}: ${n}`),
      "",
      "Alles per status:",
      ...gesorteerd(perStatus).map(([s, n]) => `- ${s}: ${n}`),
    ].join("\n"),
  });
}

/**
 * Per klant: hoe vaak, waarover, en sinds wanneer.
 *
 * Dit is de bron voor "hoeveel klachten heeft klant X gedaan" en "hoe vaak
 * stelt die dezelfde vraag". De categorieverdeling per klant staat er
 * uitgeschreven bij, want dát is het antwoord op die tweede vraag: drie keer
 * `levertijd_status` betekent drie keer dezelfde vraag.
 */
export function perKlantSource(
  rows: readonly InzichtRow[],
  tickets: readonly InzichtTicket[],
  klachtCategorieen: readonly string[],
): AssistantSource | null {
  const perKlant = new Map<string, InzichtRow[]>();
  for (const r of rows) {
    const adres = adresVan(r.from_address);
    if (!adres) continue;
    perKlant.set(adres, [...(perKlant.get(adres) ?? []), r]);
  }
  if (perKlant.size === 0) return null;

  const ticketsPerKlant = tel(tickets, (t) => t.contactEmail?.toLowerCase() ?? null);
  const klacht = new Set(klachtCategorieen);

  const blokken = [...perKlant.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_KLANTEN)
    .map(([adres, eigen]) => {
      const perCategorie = tel(eigen, (r) => r.category ?? "geen categorie");
      const klachten = eigen.filter((r) => r.category && klacht.has(r.category)).length;
      const datums = eigen.map((r) => r.created_at).sort();
      return [
        `${adres}`,
        `  Berichten: ${eigen.length}`,
        `  Waarvan klacht: ${klachten}`,
        `  Tickets: ${ticketsPerKlant.get(adres) ?? 0}`,
        `  Eerste bericht: ${dag(datums[0]!)}`,
        `  Laatste bericht: ${dag(datums[datums.length - 1]!)}`,
        `  Per categorie:`,
        ...gesorteerd(perCategorie).map(([c, n]) => `    - ${c}: ${n}`),
      ].join("\n");
    });

  return makeSource({
    id: "inzicht:klanten",
    kind: "werkvoorraad",
    label: `Per klant (${Math.min(perKlant.size, MAX_KLANTEN)} van ${perKlant.size})`,
    text: [
      perKlant.size > MAX_KLANTEN
        ? `Let op: alleen de ${MAX_KLANTEN} klanten met de meeste berichten staan hier. ` +
          `Er zijn er ${perKlant.size} in totaal.`
        : `Alle ${perKlant.size} klanten met minstens één bericht.`,
      "",
      ...blokken,
    ].join("\n\n"),
  });
}

/**
 * Wat er steeds terugkomt.
 *
 * Twee kanten van dezelfde vraag: hoe vaak een catégorie voorkomt (dat is "hoe
 * vaak vraagt iemand waar zijn bestelling blijft") en hoe vaak een concreet
 * ónderwerp terugkomt, over klanten heen. Het tweede is grover — onderwerpen
 * verschillen per mail — maar het laat een patroon zien dat een categorie niet
 * toont.
 */
export function terugkerendSource(
  rows: readonly InzichtRow[],
): AssistantSource | null {
  if (rows.length === 0) return null;

  const perCategorie = gesorteerd(tel(rows, (r) => r.category ?? "geen categorie"));
  const klantenPerCategorie = new Map<string, Set<string>>();
  for (const r of rows) {
    const c = r.category ?? "geen categorie";
    const adres = adresVan(r.from_address);
    if (!adres) continue;
    klantenPerCategorie.set(c, (klantenPerCategorie.get(c) ?? new Set()).add(adres));
  }

  // Onderwerp genormaliseerd: het Re:-voorvoegsel en losse cijfers eruit, zodat
  // "Re: Waar blijft DEMO-1001" en "Waar blijft DEMO-1004" op één hoop komen.
  const perOnderwerp = tel(rows, (r) =>
    r.subject
      ? r.subject
          .toLowerCase()
          .replace(/^((re|fw|fwd)\s*:\s*)+/i, "")
          .replace(/\b[a-z]*-?\d{3,}\b/g, "…")
          .trim() || null
      : null,
  );

  return makeSource({
    id: "inzicht:terugkerend",
    kind: "werkvoorraad",
    label: "Terugkerende vragen",
    text: [
      "Hoe vaak een soort vraag voorkomt, en bij hoeveel verschillende klanten:",
      ...perCategorie.map(
        ([c, n]) =>
          `- ${c}: ${n} keer, bij ${klantenPerCategorie.get(c)?.size ?? 0} klanten`,
      ),
      "",
      "Onderwerpen die vaker dan eens voorkomen (ordernummers vervangen door …):",
      ...(() => {
        const vaker = gesorteerd(perOnderwerp)
          .filter(([, n]) => n > 1)
          .slice(0, MAX_ONDERWERPEN);
        return vaker.length > 0
          ? vaker.map(([o, n]) => `- "${o}": ${n} keer`)
          : ["- geen onderwerp komt vaker dan eens voor"];
      })(),
    ].join("\n"),
  });
}

/**
 * Het dossier van één klant, voor een gesprek over een geopend voorstel.
 *
 * Dezelfde telling als hierboven maar dan voor deze ene afzender, zodat "heeft
 * hij dit eerder gemeld" niet uit een lijst van dertig klanten hoeft te komen.
 */
export function klantInzichtSource(
  rows: readonly InzichtRow[],
  email: string | null,
  huidigeId: string,
): AssistantSource | null {
  const adres = adresVan(email);
  if (!adres) return null;

  const eigen = rows.filter((r) => adresVan(r.from_address) === adres);
  if (eigen.length === 0) return null;

  const perCategorie = gesorteerd(tel(eigen, (r) => r.category ?? "geen categorie"));
  const eerder = eigen.filter((r) => r.id !== huidigeId);

  return makeSource({
    id: `inzicht:klant:${adres}`,
    kind: "klanthistorie",
    label: `Deze klant in cijfers (${eigen.length} berichten)`,
    text: [
      `Klant: ${adres}`,
      `Berichten in totaal: ${eigen.length}`,
      `Waarvan eerder dan dit bericht: ${eerder.length}`,
      "",
      "Per categorie:",
      ...perCategorie.map(([c, n]) => `- ${c}: ${n}`),
      "",
      "Alle berichten, nieuwste eerst:",
      ...eigen
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(
          (r) =>
            `- ${dag(r.created_at)} [${r.category ?? "geen categorie"}] ${r.subject ?? r.summary ?? "(geen onderwerp)"}` +
            (r.id === huidigeId ? "  ← dit bericht" : ""),
        ),
    ].join("\n"),
  });
}

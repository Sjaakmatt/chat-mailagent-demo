/**
 * Wat de assistent mag lezen: bronnen met een stabiele id, zodat een citaat na
 * te lopen is.
 *
 * De id is het hele punt. Een antwoord dat zegt "volgens het beleid mag dat"
 * zonder erbij te zeggen wélke regel, is niet controleerbaar — en daarmee net
 * zo goed verzonnen. Elke bron krijgt daarom een id die de assistent moet
 * noemen en die de cockpit terugvertaalt naar een klikbare vindplaats.
 */

/** Waar een bron vandaan komt. Bepaalt hoe de cockpit 'm toont. */
export type AssistantSourceKind =
  /** Het beslislog van de run die dit voorstel maakte. */
  | 'beslislog'
  /** Het voorstel zelf: het concept, de classificatie, de zekerheid. */
  | 'voorstel'
  /** Eerdere tickets, gesprekken of orders van dezelfde klant. */
  | 'klanthistorie'
  /** Een beleidsregel uit de cockpit. */
  | 'beleid'
  /** Een eerder afgehandelde zaak die op deze lijkt. */
  | 'eerdere_zaak'
  /** Een uitgevoerde aggregatie, met zijn volledige verantwoording (laag 2). */
  | 'aggregatie';

/**
 * Eén stuk context dat de assistent mag gebruiken.
 *
 * `text` is wat het model te zien krijgt en is bewust al platgeslagen: het
 * ophalen weet welke velden ertoe doen, het model hoort geen ruwe JSON te
 * hoeven interpreteren.
 */
export interface AssistantSource {
  /**
   * Stabiel binnen één vraag, bv. `beleid:pol-12` of `ticket:tkt-fa-001`.
   * De assistent citeert deze id; de cockpit maakt er een link van.
   */
  id: string;
  kind: AssistantSourceKind;
  /** Wat de medewerker in de bronnenlijst ziet staan. */
  label: string;
  /** Waar dit te vinden is in de cockpit. Geen href = geen link. */
  href?: string;
  /** De inhoud, plat. Dit is wat het model leest. */
  text: string;
}

/** Maximale lengte per bron. Voorbij dit punt wordt afgekapt met een melding. */
const MAX_SOURCE_CHARS = 4000;

/**
 * Kapt een bron af op een leesbare grens.
 *
 * Bewust mét een zichtbare melding en niet stil: een model dat een half
 * beleidsstuk leest en denkt dat het compleet is, citeert met valse zekerheid.
 * Zo weet het dat er meer is en kan het dat zeggen.
 */
export function truncateSource(text: string, max = MAX_SOURCE_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[afgekapt — deze bron is langer dan hier getoond]`;
}

/** Bouwt een bron en kapt 'm meteen af. */
export function makeSource(source: AssistantSource): AssistantSource {
  return { ...source, text: truncateSource(source.text) };
}

/**
 * Rendert de bronnen voor de prompt. Elke bron krijgt zijn id in de kop, want
 * dát is wat het model moet citeren.
 */
export function renderSources(sources: readonly AssistantSource[]): string {
  if (sources.length === 0) return '(geen bronnen beschikbaar)';
  return sources
    .map((s) => `<bron id="${s.id}" soort="${s.kind}" titel="${s.label}">\n${s.text}\n</bron>`)
    .join('\n\n');
}

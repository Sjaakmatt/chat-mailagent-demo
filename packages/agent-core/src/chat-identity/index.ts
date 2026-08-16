/**
 * Identiteit op het chatkanaal — wie is deze bezoeker, en kunnen we dat geloven?
 *
 * ## Het probleem
 *
 * Webshops hebben ingelogde klanten, en het is logisch om het gesprek aan zo'n
 * klant te hangen in plaats van aan een willekeurig id in localStorage. Dan
 * volgt het gesprek de klant over apparaten heen, en ziet de volgende persoon
 * op een gedeelde computer niets.
 *
 * Alleen: de widget draait in de browser van de bezoeker. Geeft de winkel enkel
 * `klant-id=123` mee, dan zet ik dat zelf op 124 en lees ik het gesprek van een
 * ander. Dat is geen randgeval — het is de eerste vraag die een pentester stelt.
 *
 * ## De oplossing
 *
 * De **server** van de winkel ondertekent het klant-id met een geheim dat de
 * browser nooit ziet:
 *
 *   hash = HMAC-SHA256(geheim, klantId)   → als hex
 *
 * De widget stuurt `klantId` én `hash` mee; de Worker rekent hetzelfde uit met
 * hetzelfde geheim en vergelijkt. Klopt het niet, dan is de bezoeker gewoon
 * anoniem — er wordt niets geweigerd, alleen niets aangenomen.
 *
 * Dit is dezelfde constructie die Intercom en Crisp gebruiken, en dat is een
 * voordeel: wie zo'n koppeling eerder heeft gemaakt, herkent het meteen.
 *
 * ## Wat dit niet doet
 *
 * De handtekening heeft geen vervaldatum. Lekt een hash, dan blijft die geldig
 * voor die ene klant tot het geheim wordt vervangen. Een tijdstempel meetekenen
 * zou dat begrenzen, maar dwingt elke integratie tot exact gelijklopende klokken
 * en een extra veld — en de praktijk leert dat dát juist de koppelingen zijn die
 * stukgaan. Rotatie van het geheim is hier het antwoord.
 *
 * De module is puur: geen fetch, geen opslag, geen `Date.now()`. Alleen
 * `crypto.subtle`, dat overal draait waar deze agent draait.
 */

/** Wat er over de identiteit van een bezoeker bekend is. */
export interface ChatIdentity {
  /** Is het klant-id geverifieerd met een geldige handtekening? */
  verified: boolean;
  /** Het klant-id zoals de winkel het kent. Alleen gezet als `verified`. */
  customerId?: string;
  /** Voor het beslislog. Nooit naar de bezoeker. */
  reason: string;
}

const encoder = new TextEncoder();

/** Vergelijking die niet verraadt hoevéél er klopte. */
function equalsConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256 als kleine-letter hex. Zelfde uitkomst als PHP's `hash_hmac`. */
export async function signCustomerId(customerId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(customerId));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Beoordeelt wat de widget over de bezoeker beweert.
 *
 * Faalt er iets — geen geheim, geen id, geen hash, verkeerde hash — dan is het
 * resultaat `verified: false` en gaat de bezoeker als anoniem verder. Bewust
 * geen fout: een winkel die de koppeling half heeft ingericht hoort een
 * werkende chat te houden, geen dichte deur. De `reason` maakt zichtbaar wat er
 * misging.
 */
export async function verifyChatIdentity(
  claimed: { customerId?: string | null; hash?: string | null },
  secret: string | undefined,
): Promise<ChatIdentity> {
  const customerId = claimed.customerId?.trim();
  const hash = claimed.hash?.trim().toLowerCase();

  if (!customerId && !hash) return { verified: false, reason: 'anoniem' };
  if (!secret) {
    // De pagina beweert een identiteit terwijl wij niets kunnen controleren.
    // Dat is een configuratiefout aan de winkelkant en hoort op te vallen.
    return { verified: false, reason: 'CHAT_IDENTITY_SECRET niet gezet — claim genegeerd' };
  }
  if (!customerId || !hash) {
    return { verified: false, reason: 'klant-id of handtekening ontbreekt' };
  }
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return { verified: false, reason: 'handtekening heeft niet de vorm van sha256-hex' };
  }

  const verwacht = await signCustomerId(customerId, secret);
  if (!equalsConstantTime(verwacht, hash)) {
    return { verified: false, reason: 'handtekening klopt niet' };
  }
  return { verified: true, customerId, reason: 'geverifieerd' };
}

/**
 * De sessienaam voor een geverifieerde klant.
 *
 * Afgeleid en niet het rauwe id, om twee redenen: het klant-id staat dan niet in
 * een URL of een logregel, en de naam heeft altijd dezelfde vorm ongeacht wat de
 * winkel als id gebruikt (een getal, een e-mailadres, een UUID).
 *
 * Deterministisch, want dát is de hele bedoeling: dezelfde klant komt morgen op
 * een ander apparaat uit bij hetzelfde gesprek.
 */
export async function customerSessionId(customerId: string, secret: string): Promise<string> {
  const hex = await signCustomerId(`session:${customerId}`, secret);
  return `u-${hex.slice(0, 32)}`;
}

/**
 * Inbound webhooks — de verificatie, los van de route.
 *
 * ## Waarom dit hier staat en niet in de Worker
 *
 * Een handtekening controleren is de enige stap tussen "iemand op internet" en
 * "een signaal in de wachtrij". Dat wil je kunnen testen zonder een Worker te
 * starten, en je wilt dat elke klant dezelfde controle draait. De route zelf is
 * tien regels plumbing; wat hier staat is de grens.
 *
 * ## Het schema
 *
 * De bron ondertekent `<timestamp>.<body>` met HMAC-SHA256 en stuurt:
 *
 *   X-Aios-Timestamp: 1787300000        (seconden sinds epoch)
 *   X-Aios-Signature: sha256=<hex>
 *
 * De timestamp zit **in** de ondertekende tekst. Zonder dat zou een oude,
 * geldige handtekening met een verse timestamp opnieuw ingediend kunnen worden,
 * en dan is het replay-venster geen grens maar decoratie.
 *
 * Geen ondersteuning voor een handtekening zonder timestamp. Dat is een keuze:
 * een variant zonder replay-bescherming zou de zwakste vorm zijn die iedereen
 * per ongeluk gebruikt.
 */

/** Hoe oud een verzoek mag zijn. Ruim genoeg voor een trage retry, kort genoeg om te tellen. */
export const REPLAY_WINDOW_SECONDS = 300;

/**
 * Maximale body die we aannemen.
 *
 * Een webhook is een gebeurtenis, geen bestandsoverdracht. Wie meer stuurt,
 * stuurt iets anders dan bedoeld — en een limiet die pas bij het verwerken
 * knelt, is er een die geheugen kost voordat hij werkt.
 */
export const MAX_WEBHOOK_BODY_BYTES = 128 * 1024;

export type WebhookRejection =
  | 'geen_geheim'
  | 'geen_handtekening'
  | 'geen_timestamp'
  | 'timestamp_onleesbaar'
  | 'buiten_venster'
  | 'handtekening_klopt_niet'
  | 'body_te_groot';

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: WebhookRejection; detail?: string };

export interface WebhookVerifyInput {
  /** De ruwe body, exact zoals hij binnenkwam. Nooit opnieuw geserialiseerd. */
  body: string;
  /** Waarde van `X-Aios-Signature`; `sha256=`-prefix mag, maar hoeft niet. */
  signature: string | null;
  /** Waarde van `X-Aios-Timestamp`, in seconden sinds epoch. */
  timestamp: string | null;
  /** Het geheim van déze bron. Ontbreekt hij, dan is de bron niet ingericht. */
  secret: string | undefined;
  /** Nu, in milliseconden. Injecteerbaar zodat het venster testbaar is. */
  now?: number;
}

/**
 * Controleert een binnengekomen webhook.
 *
 * Geeft een reden terug in plaats van alleen `false`, want die reden gaat het
 * log in. Zonder reden is "401" niet te onderscheiden van "de klok van de bron
 * loopt drie uur achter", en dat is precies het verschil tussen een aanval en
 * een configuratiefout.
 */
export async function verifyWebhook(
  input: WebhookVerifyInput,
): Promise<WebhookVerification> {
  if (!input.secret) return { ok: false, reason: 'geen_geheim' };

  // De body-limiet vóór het rekenwerk: een HMAC over tien megabyte is tien
  // megabyte werk dat je een vreemde cadeau doet.
  const bytes = new TextEncoder().encode(input.body).length;
  if (bytes > MAX_WEBHOOK_BODY_BYTES) {
    return { ok: false, reason: 'body_te_groot', detail: `${bytes} bytes` };
  }

  if (!input.signature) return { ok: false, reason: 'geen_handtekening' };
  if (!input.timestamp) return { ok: false, reason: 'geen_timestamp' };

  const seconden = Number.parseInt(input.timestamp, 10);
  if (!Number.isFinite(seconden)) {
    return { ok: false, reason: 'timestamp_onleesbaar' };
  }

  // Absoluut verschil: een timestamp uit de toekomst is net zo verdacht als een
  // uit het verleden, en een bron met een vooruitlopende klok hoort dat te
  // merken in plaats van er stilzwijgend mee weg te komen.
  const nu = Math.floor((input.now ?? Date.now()) / 1000);
  const verschil = Math.abs(nu - seconden);
  if (verschil > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'buiten_venster', detail: `${verschil}s` };
  }

  const verwacht = await hmacHex(input.secret, `${input.timestamp}.${input.body}`);
  const gegeven = input.signature.replace(/^sha256=/i, '').trim().toLowerCase();
  if (!timingSafeEqual(verwacht, gegeven)) {
    return { ok: false, reason: 'handtekening_klopt_niet' };
  }

  return { ok: true };
}

/** HMAC-SHA256 als hex. WebCrypto, dus geen Node-only afhankelijkheid. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Vergelijkt twee hex-strings in constante tijd.
 *
 * `a === b` stopt bij het eerste verschillende teken, en dat verschil is te
 * meten. Bij een handtekening betekent dat: teken voor teken raden tot je 'm
 * hebt. Deze vergelijking loopt altijd de hele string af.
 *
 * De lengtecheck vooraf lekt alleen de lengte, en die ligt al vast (64 hex-
 * tekens voor SHA-256).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let verschil = 0;
  for (let i = 0; i < a.length; i++) {
    verschil |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return verschil === 0;
}

/**
 * De idempotency-sleutel voor een binnengekomen event.
 *
 * Bij voorkeur het id van de bron: die weet zelf wanneer hij hetzelfde event
 * opnieuw stuurt, en dat is precies wat je wilt ontdubbelen. Ontbreekt dat,
 * dan valt hij terug op een digest van de body — dan dedupliceert een letterlijk
 * identieke retry nog steeds, en een nieuw event met dezelfde inhoud niet meer,
 * maar dat is de zeldzamere fout van de twee.
 */
export async function webhookIdempotencyKey(input: {
  source: string;
  eventId: string | null;
  body: string;
}): Promise<string> {
  if (input.eventId?.trim()) return `hook:${input.source}:${input.eventId.trim()}`;
  const digest = await sha256Hex(input.body);
  return `hook:${input.source}:sha:${digest.slice(0, 32)}`;
}

async function sha256Hex(message: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * De env-sleutel waar het geheim van deze bron staat.
 *
 * `exact-online` → `WEBHOOK_SECRET_EXACT_ONLINE`. Streepjes worden liggende
 * streepjes omdat een env-naam die niet kent; hoofdletters omdat dat de
 * conventie is en een var-naam hoofdlettergevoelig is.
 */
export function webhookSecretKey(source: string): string {
  return `WEBHOOK_SECRET_${source.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/**
 * Is dit een bronnaam die we überhaupt in behandeling nemen?
 *
 * Streng, want de naam gaat een env-sleutel in en wordt het domein van het
 * signaal. Een naam met vreemde tekens erin is geen bron die wij hebben
 * ingericht, en dan hoort het antwoord 404 te zijn voordat er iets gebeurt.
 */
export function isValidSourceName(source: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(source);
}

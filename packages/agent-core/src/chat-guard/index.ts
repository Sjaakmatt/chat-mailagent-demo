/**
 * Bewaking op het chat-kanaal — wat er vóór de lus staat.
 *
 * Mail komt binnen via een MCP met eigen auth; chat komt van een willekeurige
 * bezoeker op een publieke pagina. Dat is een wezenlijk ander dreigingsbeeld:
 * er zit geen mens tussen, `kennis` en `systeem` gaan direct naar buiten, en
 * elk bericht kost LLM-calls op de sleutel van de klant.
 *
 * Deze module is bewust puur: geen fetch, geen storage, geen Date.now(). De
 * aanroeper (`chat/session-do.ts`) levert de tijd en bewaart de staat. Zo is
 * het gedrag testbaar zonder Durable Object, en kan een tweede kanaal (telefonie)
 * dezelfde bewaking hergebruiken.
 *
 * ## Wat dit wél en niet tegenhoudt
 *
 * De origin-check houdt tegen dat een *andere website* jouw widget insluit en
 * op jouw rekening laat praten. Hij houdt géén script tegen: wie zelf HTTP
 * doet, zet de `Origin`-header op wat hij wil. Tegen dát misbruik staat de
 * rate limiting, en die is dan ook de enige harde grens op kosten.
 */

/** Lengte van het venster voor de per-minuut-limiet. */
const WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Origin
// ---------------------------------------------------------------------------

/** Kleine letters, zonder afsluitende slash — zodat vergelijken betrouwbaar is. */
function normalizeOrigin(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, '');
}

/**
 * Mag een pagina met deze `Origin` een chatsessie openen?
 *
 * - `allowlist` leeg/ongezet → alleen de Worker zelf. Dat houdt de testwidget
 *   werkend (die wordt van dezelfde origin geserveerd) en sluit insluiting
 *   door derden uit. Bewust géén fail-open: een vergeten var mag niet
 *   betekenen dat de hele wereld erbij kan.
 * - `allowlist` bevat `*` → alles toegestaan. Alleen voor lokale ontwikkeling;
 *   op productie hoort hier de echte domeinlijst te staan.
 * - Ontbrekende `Origin`-header → geweigerd. Een browser stuurt 'm altijd mee
 *   bij een WebSocket vanaf een pagina; ontbreekt hij, dan is het geen browser.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  allowlist: string | undefined,
  selfOrigin: string,
): boolean {
  const entries = (allowlist ?? '')
    .split(',')
    .map((o) => normalizeOrigin(o))
    .filter((o) => o.length > 0);

  if (entries.includes('*')) return true;
  if (!origin) return false;

  const candidate = normalizeOrigin(origin);
  if (candidate === normalizeOrigin(selfOrigin)) return true;
  return entries.includes(candidate);
}

/**
 * Waarde voor `Content-Security-Policy: frame-ancestors` op de widget-iframe.
 *
 * Dit is het échte slot op insluiting, en niet de origin-check op de socket.
 * De widget wordt geserveerd vanaf de Worker, dus een WebSocket die vanuit de
 * iframe opengaat heeft de Worker als `Origin` — de allowlist zou daar altijd
 * "eigen origin" zien en dus nooit iets tegenhouden. `frame-ancestors` legt de
 * vraag bij de browser: die weigert de iframe te renderen op een pagina die er
 * niet in staat, en dat kan een site niet omzeilen.
 *
 * Ongezet → `'self'`: alleen de Worker mag zichzelf insluiten. `*` → `*`,
 * alleen voor lokale ontwikkeling.
 */
export function frameAncestors(allowlist: string | undefined): string {
  const entries = (allowlist ?? '')
    .split(',')
    .map((o) => normalizeOrigin(o))
    .filter((o) => o.length > 0);

  if (entries.length === 0) return "'self'";
  if (entries.includes('*')) return '*';
  // 'self' blijft erbij, anders breekt de testwidget op de Worker zelf.
  return ["'self'", ...entries].join(' ');
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Telstand van één sessie. Hoort in duurzame opslag: een Durable Object kan
 * tussen twee berichten worden geëvicteerd, en een teller in geheugen zou dan
 * terugspringen naar nul — precies het gat dat een misbruiker nodig heeft.
 */
export interface ChatRateState {
  /** Begin van het huidige minuut-venster, in ms sinds epoch. */
  windowStart: number;
  /** Aantal berichten binnen dat venster. */
  inWindow: number;
  /** Totaal in deze sessie, over alle vensters heen. */
  total: number;
}

export interface ChatRateLimits {
  /** Berichten per minuut per sessie. */
  perMinute: number;
  /** Harde bovengrens voor de hele sessie. */
  perSession: number;
}

export type ChatRateDecision =
  | { allowed: true; state: ChatRateState }
  | {
      allowed: false;
      /** `per_minute` gaat vanzelf over; `session_total` niet. */
      reason: 'per_minute' | 'session_total';
      /** Hoe lang wachten heeft zin. 0 = nooit meer binnen deze sessie. */
      retryAfterMs: number;
      state: ChatRateState;
    };

/** Verse telstand voor een sessie die nog niets heeft gestuurd. */
export function emptyRateState(now: number): ChatRateState {
  return { windowStart: now, inWindow: 0, total: 0 };
}

/**
 * Mag dit bericht erdoor? Geeft de nieuwe telstand terug die de aanroeper moet
 * wegschrijven — ook bij een afwijzing, want een venster kan intussen verlopen
 * zijn en dat wil je vasthouden.
 *
 * De sessiegrens gaat vóór de minuutgrens: als beide vol zitten is `wachten`
 * geen zinnig advies meer.
 */
export function evaluateRate(
  prev: ChatRateState,
  now: number,
  limits: ChatRateLimits,
): ChatRateDecision {
  // Venster verlopen → opnieuw beginnen. Het sessietotaal loopt door.
  const rolled =
    now - prev.windowStart >= WINDOW_MS
      ? { windowStart: now, inWindow: 0, total: prev.total }
      : { ...prev };

  if (rolled.total >= limits.perSession) {
    return { allowed: false, reason: 'session_total', retryAfterMs: 0, state: rolled };
  }

  if (rolled.inWindow >= limits.perMinute) {
    return {
      allowed: false,
      reason: 'per_minute',
      retryAfterMs: Math.max(0, rolled.windowStart + WINDOW_MS - now),
      state: rolled,
    };
  }

  return {
    allowed: true,
    state: { ...rolled, inWindow: rolled.inWindow + 1, total: rolled.total + 1 },
  };
}

// ---------------------------------------------------------------------------
// Berichtinhoud
// ---------------------------------------------------------------------------

export interface ParsedVisitorMessage {
  body: string;
  /** Alleen gezet als er een adres in het bericht stond of werd meegestuurd. */
  email?: string;
}

/**
 * Adres in vrije tekst. Bewust conservatief: één `@`, een domein met minstens
 * één punt, en geen leestekens aan het eind — anders wordt "mail me op
 * jan@example.com." een adres met een punt erachter.
 */
const EMAIL_IN_TEXT =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/;

/**
 * Haalt het eerste e-mailadres uit een tekst. `null` als er geen in staat.
 *
 * Waarom dit hier hoort en niet in een formulierveld: de widget vraagt niet
 * vooraf om een adres. Dat zou een drempel opwerpen vóór de eerste vraag,
 * terwijl de meeste gesprekken 'm helemaal niet nodig hebben — een vraag over
 * een prijs of een koppeling gaat niemand aan. Pas als de agent iets moet
 * opzoeken dat aan een persoon hangt, vraagt hij erom (zie
 * `CONFIRMATION.needsIdentityText`), en dan typt de bezoeker het gewoon in zijn
 * antwoord. Dit is wat dat antwoord bruikbaar maakt.
 */
export function extractEmail(text: string): string | null {
  const match = text.match(EMAIL_IN_TEXT);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Normaliseert wat er over de socket binnenkomt tot een bericht, of `null` als
 * er niets bruikbaars in zit.
 *
 * Accepteert JSON (`{ body }`) én platte tekst, want de widget stuurt het
 * eerste en handmatig testen doet vaak het tweede. Een expliciet `email`-veld
 * wordt nog geaccepteerd voor aanroepers die het meesturen, maar de widget doet
 * dat niet meer; staat het er niet, dan kijken we in de tekst zelf.
 *
 * Berichten langer dan `maxChars` worden **geweigerd** en niet afgekapt: stil
 * inkorten levert een half bericht op waar de agent op antwoordt, en dat is
 * verwarrender dan een duidelijke afwijzing.
 */
export function parseVisitorMessage(
  raw: string,
  maxChars: number,
): ParsedVisitorMessage | null {
  let text = raw;
  let email: string | undefined;

  try {
    const parsed = JSON.parse(raw) as { body?: unknown; email?: unknown };
    if (typeof parsed.body === 'string') text = parsed.body;
    if (typeof parsed.email === 'string' && parsed.email.trim()) {
      email = parsed.email.trim().toLowerCase();
    }
  } catch {
    // Platte tekst mag ook.
  }

  const body = text.trim();
  if (!body) return null;
  if (body.length > maxChars) return null;

  email ??= extractEmail(body) ?? undefined;

  return email ? { body, email } : { body };
}

/**
 * Leest een positief geheel getal uit een `var`, met terugval. Een onzinnige
 * of ontbrekende waarde mag nooit "geen limiet" betekenen — vandaar dat álles
 * wat niet als positief getal leest terugvalt op de default.
 */
export function readLimit(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * `POST /hooks/:bron` — externe gebeurtenissen op de bus.
 *
 * ## Wat deze route wél doet
 *
 * Verifiëren en emitten. Meer niet. Geen classificatie, geen lookup, geen
 * ReviewItem: de route is de deur, en achter de deur staat de lus. Dat is geen
 * netheid maar een eigenschap: een bron die tien events per seconde stuurt,
 * mag niet tien LLM-calls in een request-handler afdwingen, en een verwerking
 * die faalt mag het event niet kwijtmaken. De bus is duurzaam, de request niet.
 *
 * ## Waarom niet op de MCP-laag
 *
 * Tot fase 2 antwoordde deze Worker letterlijk "Inbound events horen op de
 * MCP-laag". Dat klopt voor bronnen waarvoor we een MCP hebben: die verifieert,
 * normaliseert naar een `Signal` en schrijft in één transactie. Maar voor een
 * bron zonder MCP was er daarmee geen weg naar binnen, en dat is precies wat
 * administratie, supply chain en sales tegenhoudt. Deze route is de weg voor de
 * rest — met dezelfde verificatie, en zonder normalisatie omdat er niets te
 * normaliseren valt zonder domeinkennis. Die zit in de hydrator.
 *
 * ## De antwoorden
 *
 * | Situatie | Antwoord |
 * | --- | --- |
 * | Onbekende of niet-ingerichte bron | 404 |
 * | Handtekening, timestamp of venster klopt niet | 401 |
 * | Body te groot | 413 |
 * | Geëmit (of al bekend) | 202 |
 *
 * Een onbekende bron krijgt 404 en geen 401: het bestaan van een bron is zelf
 * informatie, en een 401 op `/hooks/exact` verklapt dat er een exact-koppeling
 * is. Beide gevallen gaan het log in, want het verschil tussen een aanval en
 * een verkeerd gezet geheim is niet uit de statuscode te lezen.
 */

import {
  isValidSourceName,
  verifyWebhook,
  webhookIdempotencyKey,
  webhookSecretKey,
  MAX_WEBHOOK_BODY_BYTES,
} from '@factumai/agent-core';
import type { Env } from '../env.js';
import { emitSignal } from './emit.js';

/** De headers waarmee een bron zich legitimeert. */
const HEADER_SIGNATURE = 'x-aios-signature';
const HEADER_TIMESTAMP = 'x-aios-timestamp';
const HEADER_EVENT_ID = 'x-aios-event-id';
const HEADER_EVENT_TYPE = 'x-aios-event-type';

/**
 * Het geheim van deze bron uit de env.
 *
 * Een bron **bestaat** als er een geheim voor staat. Dat is met opzet de enige
 * definitie: een aparte lijst met toegestane bronnen zou uit de pas gaan lopen
 * met de secrets, en dan is er een bron die 404 geeft terwijl het geheim er is,
 * of andersom.
 */
function secretFor(env: Env, source: string): string | undefined {
  const waarde = (env as unknown as Record<string, unknown>)[webhookSecretKey(source)];
  return typeof waarde === 'string' && waarde.length > 0 ? waarde : undefined;
}

/**
 * Handelt `POST /hooks/:bron` af.
 *
 * Geeft `null` als het pad niet van deze route is, zodat de fetch-handler
 * verder kan zoeken.
 */
export async function handleWebhook(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/hooks/')) return null;
  if (request.method !== 'POST') {
    return new Response('methode niet toegestaan', { status: 405 });
  }

  const source = url.pathname.slice('/hooks/'.length).split('/')[0] ?? '';
  if (!isValidSourceName(source)) {
    console.warn(`[hook] geweigerd: onbruikbare bronnaam ${JSON.stringify(source)}`);
    return new Response('onbekende bron', { status: 404 });
  }

  const secret = secretFor(env, source);
  if (!secret) {
    // Niet ingericht. Log het met de env-sleutel erbij: dit is negen van de tien
    // keer een vergeten secret en geen aanval, en dan wil je meteen zien welke.
    console.warn(
      `[hook] ${source}: geen geheim ingericht (verwacht ${webhookSecretKey(source)})`,
    );
    return new Response('onbekende bron', { status: 404 });
  }

  // Vóór het lezen: een Content-Length die er al overheen gaat, hoeven we niet
  // eerst in het geheugen te zetten om te weigeren.
  const gemeld = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(gemeld) && gemeld > MAX_WEBHOOK_BODY_BYTES) {
    console.warn(`[hook] ${source}: body te groot (${gemeld} bytes gemeld)`);
    return new Response('body te groot', { status: 413 });
  }

  const body = await request.text();

  const verificatie = await verifyWebhook({
    body,
    signature: request.headers.get(HEADER_SIGNATURE),
    timestamp: request.headers.get(HEADER_TIMESTAMP),
    secret,
  });
  if (!verificatie.ok) {
    console.warn(
      `[hook] ${source}: geweigerd (${verificatie.reason}` +
        `${verificatie.detail ? ` — ${verificatie.detail}` : ''})`,
    );
    return new Response(
      verificatie.reason === 'body_te_groot' ? 'body te groot' : 'ongeldige handtekening',
      { status: verificatie.reason === 'body_te_groot' ? 413 : 401 },
    );
  }

  // De body gaat als payload mee zoals hij binnenkwam. Niet omvormen: wat een
  // bron stuurt is het bewijsstuk, en wat het betekent weet de hydrator van dat
  // domein. Is het geen JSON, dan bewaren we de tekst — een bron die iets
  // anders stuurt dan afgesproken hoort zichtbaar te zijn in de werkbak, niet
  // te verdwijnen op een parse-fout.
  let inhoud: Record<string, unknown>;
  try {
    const geparsed: unknown = JSON.parse(body);
    inhoud =
      geparsed && typeof geparsed === 'object' && !Array.isArray(geparsed)
        ? (geparsed as Record<string, unknown>)
        : { body: geparsed };
  } catch {
    inhoud = { body };
  }

  const gebeurtenis =
    request.headers.get(HEADER_EVENT_TYPE)?.trim() ||
    (typeof inhoud.type === 'string' ? inhoud.type : '') ||
    'event';

  const idempotencyKey = await webhookIdempotencyKey({
    source,
    eventId: request.headers.get(HEADER_EVENT_ID),
    body,
  });

  try {
    const { signalId, enqueued } = await emitSignal(env, {
      domain: source,
      // `<bron>.<gebeurtenis>`, want dat is waar een module op claimt. Noemt de
      // bron zijn gebeurtenis al met een prefix, dan zetten we die er niet
      // nog een keer voor.
      type: gebeurtenis.startsWith(`${source}.`) ? gebeurtenis : `${source}.${gebeurtenis}`,
      payload: {
        ...inhoud,
        receivedAt: new Date().toISOString(),
      },
      idempotencyKey,
    });

    // 202 en niet 200: we hebben het aangenomen, niet verwerkt. En een
    // herhaling krijgt hetzelfde antwoord — een bron die 4xx krijgt op zijn
    // eigen retry, blijft het proberen.
    console.log(
      `[hook] ${source}: ${enqueued ? 'geëmit' : 'al bekend'} ${signalId ?? '(geen id)'}`,
    );
    return Response.json({ signalId, enqueued }, { status: 202 });
  } catch (err) {
    // Niet kunnen emitten is van ons, niet van de bron. 5xx, zodat hij het
    // opnieuw probeert — de idempotency-sleutel zorgt dat dat veilig is.
    console.error(
      `[hook] ${source}: emitten mislukt: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new Response('kon het event niet aannemen', { status: 503 });
  }
}

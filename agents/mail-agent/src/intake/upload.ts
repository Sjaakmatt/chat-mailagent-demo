/**
 * `POST /upload` — een geüpload document op de bus.
 *
 * ## Wat er binnenkomt: een verwijzing, geen bestand
 *
 * De bytes gaan niet door deze Worker. Wie uploadt — de cockpit, een
 * scan-postbus, een klantportaal — zet het bestand in Supabase Storage en
 * meldt hier waar het staat: bucket en pad, plus wat hij verder al weet
 * (naam, type, grootte, wie het deed).
 *
 * Dat is met opzet. Een Worker die bestanden aanneemt, moet grootte, type en
 * hervatting regelen voor iets wat Storage al doet, en een upload van 30 MB
 * die halverwege afbreekt is dan een mislukte request in plaats van een
 * hervatbare upload. En het signaal hoort een verwijzing te bevatten, niet
 * een kopie: een payload met een base64-factuur erin staat voorgoed in de
 * signaaltabel.
 *
 * ## Wat deze route níét doet: lezen
 *
 * Er wordt niets geopend, geen OCR, geen veldherkenning. Wat er in het bestand
 * staat, haalt de **hydrator van het domein** op — `hydrators/document.ts` —
 * op het moment dat de lus het signaal oppakt. Twee redenen: de extractie is
 * per klant anders (de ene heeft een factuur-MCP, de andere een scan), en een
 * request-handler is de verkeerde plek voor werk dat seconden duurt en kan
 * mislukken. De bus is duurzaam, de request niet.
 *
 * ## Wie mag dit
 *
 * Dezelfde HMAC als de webhooks, met één gedeeld geheim: `UPLOAD_SECRET`. Niet
 * ingericht is 404, precies zoals bij een bron zonder geheim — een vergeten
 * secret hoort de deur dicht te houden, niet open te zetten.
 */

import {
  verifyWebhook,
  webhookIdempotencyKey,
  MAX_WEBHOOK_BODY_BYTES,
} from '@factumai/agent-core';
import type { Env } from '../env.js';
import { emitSignal } from './emit.js';

const HEADER_SIGNATURE = 'x-aios-signature';
const HEADER_TIMESTAMP = 'x-aios-timestamp';

/** Het domein en het type waarop een module kan claimen. */
export const UPLOAD_DOMAIN = 'document';
export const UPLOAD_TYPE = 'document.uploaded';

/**
 * Handelt `POST /upload` af.
 *
 * Geeft `null` als het pad niet van deze route is, zodat de fetch-handler
 * verder kan zoeken.
 */
export async function handleUpload(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  if (url.pathname !== '/upload') return null;
  if (request.method !== 'POST') {
    return new Response('methode niet toegestaan', { status: 405 });
  }

  const secret = env.UPLOAD_SECRET?.trim();
  if (!secret) {
    console.warn('[upload] geen UPLOAD_SECRET ingericht — route staat dicht');
    return new Response('niet gevonden', { status: 404 });
  }

  const gemeld = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(gemeld) && gemeld > MAX_WEBHOOK_BODY_BYTES) {
    // Wie hier een bestand in duwt in plaats van een verwijzing, hoort dat te
    // merken op de eerste poging.
    console.warn(`[upload] body te groot (${gemeld} bytes gemeld)`);
    return new Response('body te groot; stuur een verwijzing, geen bestand', { status: 413 });
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
      `[upload] geweigerd (${verificatie.reason}` +
        `${verificatie.detail ? ` — ${verificatie.detail}` : ''})`,
    );
    return new Response(
      verificatie.reason === 'body_te_groot' ? 'body te groot' : 'ongeldige handtekening',
      { status: verificatie.reason === 'body_te_groot' ? 413 : 401 },
    );
  }

  let inhoud: Record<string, unknown>;
  try {
    const geparsed: unknown = JSON.parse(body);
    if (!geparsed || typeof geparsed !== 'object' || Array.isArray(geparsed)) {
      return new Response('verwacht een JSON-object', { status: 400 });
    }
    inhoud = geparsed as Record<string, unknown>;
  } catch {
    return new Response('onleesbare JSON', { status: 400 });
  }

  const bucket = tekst(inhoud.bucket);
  const pad = tekst(inhoud.path);
  if (!bucket || !pad) {
    // Zonder verwijzing is er geen document, alleen een melding dat er een is.
    // Dat levert verderop een voorstel op over een bestand dat niemand kan
    // openen; beter hier stoppen.
    console.warn('[upload] geweigerd: bucket of path ontbreekt');
    return new Response('bucket en path zijn verplicht', { status: 400 });
  }

  const nu = new Date().toISOString();
  const uploadId = tekst(inhoud.uploadId);

  const idempotencyKey = await webhookIdempotencyKey({
    source: 'upload',
    // Een expliciete upload-id wint. Zonder id valt de sleutel terug op een
    // hash van de melding zelf: een herhaalde melding van dezelfde upload komt
    // er dan één keer door, en een nieuwe versie van hetzelfde pad — andere
    // grootte, ander moment — als een nieuw document. Dat laatste is precies
    // wat je wilt bij een gecorrigeerde factuur op dezelfde plek.
    eventId: uploadId ?? null,
    body,
  });

  try {
    const { signalId, enqueued } = await emitSignal(env, {
      domain: UPLOAD_DOMAIN,
      type: UPLOAD_TYPE,
      payload: {
        // Alles wat de uploader meestuurde blijft staan: wat het betekent weet
        // de hydrator van dit domein, niet deze route.
        ...inhoud,
        bucket,
        path: pad,
        // De bestandsnaam is wat de envelop als onderwerp toont. Ontbreekt hij,
        // dan is het laatste stuk van het pad het dichtst bij de waarheid.
        filename: tekst(inhoud.filename) ?? pad.split('/').pop() ?? pad,
        uploadedAt: tekst(inhoud.uploadedAt) ?? nu,
        receivedAt: nu,
      },
      idempotencyKey,
    });

    console.log(
      `[upload] ${bucket}/${pad}: ${enqueued ? 'geëmit' : 'al bekend'} ${signalId ?? '(geen id)'}`,
    );
    return Response.json({ signalId, enqueued }, { status: 202 });
  } catch (err) {
    // Van ons, niet van de uploader. 5xx zodat hij het opnieuw probeert; de
    // idempotency-sleutel maakt dat veilig.
    console.error(
      `[upload] emitten mislukt: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new Response('kon de upload niet aannemen', { status: 503 });
  }
}

/** Een niet-lege tekst, of null. */
function tekst(waarde: unknown): string | null {
  return typeof waarde === 'string' && waarde.trim() ? waarde.trim() : null;
}

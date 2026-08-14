/**
 * Dunne wrapper rond de Resend HTTPS API (https://resend.com/docs/api).
 *
 * Alternatief voor Microsoft Graph als verzendpad (`MAIL_SEND_VIA=resend`).
 * Nuttig zolang een verse M365-tenant nog IP-reputatie opbouwt: met DKIM op het
 * verzenddomein krijgen ontvangers een DKIM=pass-handtekening plus Resend's
 * bestaande IP-reputatie, in plaats van een onbekend M365-IP.
 *
 * Tegelijk wil je dat Outlook van mail-agent@factumai.nl de verzonden mail
 * netjes in *Verzonden items* laat zien — dat doet `deliverMailReply`
 * via `mail_save_to_sent`. Deze module weet daar niks van: hier alleen het
 * HTTP-call met de juiste headers.
 */

export interface ResendSendInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  /** Optioneel: BCC voor archief-mailbox e.d. */
  bcc?: string;
  /** RFC-2822 Message-ID van de mail waarop we antwoorden (zónder <>). */
  inReplyTo?: string;
  /** Volledige References-chain (oude IDs, nieuwste laatst). */
  references?: string[];
}

export interface ResendSendResult {
  id: string;
}

export async function sendViaResend(
  apiKey: string,
  input: ResendSendInput,
): Promise<ResendSendResult> {
  // Threading: Resend-API neemt `headers` mee onder de hood. In-Reply-To +
  // References zorgen dat de mail bij de klant in dezelfde thread belandt
  // (Gmail/Outlook/Apple Mail volgen RFC-5322).
  const headers: Record<string, string> = {};
  if (input.inReplyTo) {
    headers['In-Reply-To'] = bracket(input.inReplyTo);
  }
  if (input.references && input.references.length > 0) {
    headers['References'] = input.references.map(bracket).join(' ');
  }

  const body: Record<string, unknown> = {
    from: input.from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
  };
  if (input.bcc) body.bcc = [input.bcc];
  if (Object.keys(headers).length > 0) body.headers = headers;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error('Resend gaf geen id terug');
  return { id: json.id };
}

function bracket(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed;
  return `<${trimmed}>`;
}

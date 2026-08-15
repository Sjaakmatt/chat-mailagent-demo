/**
 * Tickets — uitzoekwerk voor een mens, met een nummer dat de klant krijgt
 * (bouwbriefing §4).
 *
 * Een ticket ontstaat alleen bij uitkomst `taak`. Niet bij `onbekend`: dan
 * vraagt de agent door. Dat onderscheid is de reden dat de werkbak niet
 * volloopt met gesprekken die geen taak zijn.
 *
 * ## De tussenstap die vooraf gaat
 *
 * Voordat er een ticket komt, vraagt de agent om mailadres en ordernummer.
 * Zonder mailadres is er geen terugkoppelkanaal — een chatbezoeker is weg
 * zodra hij het venster sluit. `ticketReadiness()` bepaalt of we genoeg
 * hebben, en zo niet, wat er nog moet gebeuren.
 */

import type { ChannelId } from '../channels/index.js';

// ---------------------------------------------------------------------------
// Ticketnummer
// ---------------------------------------------------------------------------

/**
 * Prefix per tenant, drie letters. Staat in het control plane; hier de vorm
 * plus een veilige terugval, zodat een ontbrekende config geen kapotte nummers
 * oplevert.
 */
export const DEFAULT_TICKET_PREFIX = 'TIC';

export function normalizeTicketPrefix(raw: string | null | undefined): string {
  const cleaned = (raw ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return cleaned.length === 3 ? cleaned : DEFAULT_TICKET_PREFIX;
}

/** Periode-deel van het nummer: JJMM. */
export function ticketPeriod(at: Date): string {
  const jj = String(at.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${jj}${mm}`;
}

/**
 * Stelt het nummer samen. De teller komt uit de database (`aios_next_ticket_number`)
 * omdat twee gelijktijdige runs anders hetzelfde nummer zouden uitgeven; deze
 * functie is de vorm, niet de bron.
 */
export function formatTicketNumber(prefix: string, period: string, counter: number): string {
  return `${normalizeTicketPrefix(prefix)}-${period}-${String(counter).padStart(4, '0')}`;
}

const TICKET_NUMBER_RE = /\b([A-Z]{3})-(\d{4})-(\d{4,})\b/;

/**
 * Zoekt een ticketnummer in een bericht. Noemt een klant er een, dan hoort z'n
 * bericht bij dat ticket in plaats van dat er een nieuw gesprek begint — over
 * kanalen heen: een ticket uit chat mag per mail worden opgevolgd.
 */
export function findTicketNumber(text: string): string | null {
  const m = text.toUpperCase().match(TICKET_NUMBER_RE);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------
// Is er genoeg om een ticket te maken?
// ---------------------------------------------------------------------------

export type TicketReadiness =
  /** Alles bekend: ticket met volledige koppeling aan de order. */
  | { state: 'complete'; contactEmail: string; orderReference: string }
  /** Alleen mailadres: ticket zonder order, met een notitie voor de medewerker. */
  | { state: 'partial'; contactEmail: string; note: string }
  /** Niets bruikbaars: géén ticket. Doorvragen, en bij weigering overdragen. */
  | { state: 'insufficient'; missing: Array<'contactEmail' | 'orderReference'> };

export interface TicketIdentity {
  contactEmail?: string | null;
  orderReference?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Bepaalt of we een ticket kunnen maken.
 *
 * Het mailadres is de harde eis: zonder terugkoppelkanaal heeft een ticket geen
 * zin. Het ordernummer is prettig maar niet blokkerend — een medewerker kan
 * ernaar vragen, een verdwenen chatbezoeker niet.
 */
export function ticketReadiness(identity: TicketIdentity): TicketReadiness {
  const email = identity.contactEmail?.trim() ?? '';
  const order = identity.orderReference?.trim() ?? '';
  const hasEmail = EMAIL_RE.test(email);

  if (!hasEmail) {
    const missing: Array<'contactEmail' | 'orderReference'> = ['contactEmail'];
    if (!order) missing.push('orderReference');
    return { state: 'insufficient', missing };
  }

  if (!order) {
    return {
      state: 'partial',
      contactEmail: email,
      note: 'Geen ordernummer opgegeven — bij de klant navragen.',
    };
  }

  return { state: 'complete', contactEmail: email, orderReference: order };
}

// ---------------------------------------------------------------------------
// Wat de klant te horen krijgt
// ---------------------------------------------------------------------------

export interface ConfirmationConfig {
  /**
   * Vaste opzet, per tenant instelbaar. `{number}` wordt vervangen door het
   * ticketnummer; verder komt er niets uit een model.
   *
   * Bewust géén doorlooptijdbelofte in de standaardtekst — wil een tenant die
   * wel, dan is dat een bewuste instelling en geen bijwerking.
   */
  template: string;
  /** Tekst als er (nog) geen ticket is omdat de identificatie ontbreekt. */
  needsIdentityText: string;
  /** Als alleen het mailadres nog ontbreekt. Het ordernummer is al bekend. */
  needsEmailText: string;
  /** Als alleen het ordernummer nog ontbreekt. */
  needsOrderText: string;
}

export const CONFIRMATION: ConfirmationConfig = {
  template:
    'Dit is uitzoekwerk voor een collega. Ik heb er ticket {number} voor ' +
    'aangemaakt; je hoort zo snel mogelijk van ons.',
  needsIdentityText:
    'Om dit voor je uit te zoeken heb ik je e-mailadres nodig, en als je het ' +
    'bij de hand hebt ook je ordernummer.',
  // Waarom drie teksten en niet één: wie net zijn ordernummer heeft gegeven en
  // dezelfde vraag terugkrijgt, denkt dat de chat kapot is. Erkennen wat er al
  // binnen is, kost één zin en scheelt dat gevoel volledig.
  needsEmailText:
    'Dank je, dat ordernummer heb ik. Wat is het e-mailadres waarmee je hebt ' +
    'besteld? Dan zoek ik het meteen op.',
  needsOrderText:
    'Dank je, dat mailadres heb ik. Heb je het ordernummer er ook bij? Dan ' +
    'zoek ik het meteen op.',
};

/**
 * Welke tekst hoort bij wat er nog ontbreekt.
 *
 * Zonder dit krijgt een bezoeker die net iets heeft aangeleverd letterlijk
 * dezelfde vraag terug — en dat leest als een chat die niet luistert.
 */
export function identityPrompt(
  have: { email?: string | null; order?: string | null },
  config: ConfirmationConfig = CONFIRMATION,
): string {
  const email = Boolean(have.email?.trim());
  const order = Boolean(have.order?.trim());
  if (order && !email) return config.needsEmailText;
  if (email && !order) return config.needsOrderText;
  return config.needsIdentityText;
}

/**
 * Vult het ticketnummer in. Ontbreekt de placeholder in een aangepaste
 * template, dan plakken we het nummer er achteraan in plaats van het stil te
 * laten verdwijnen — een bevestiging zonder nummer is waardeloos.
 */
export function confirmationText(
  number: string,
  config: ConfirmationConfig = CONFIRMATION,
): string {
  if (config.template.includes('{number}')) {
    return config.template.replaceAll('{number}', number);
  }
  return `${config.template} (${number})`;
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface Ticket {
  id: string;
  organizationId: string;
  number: string;
  conversationId?: string | null;
  reviewItemId?: string | null;
  status: TicketStatus;
  category?: string | null;
  summary: string;
  contactEmail?: string | null;
  orderReference?: string | null;
  claimedAt?: string | null;
  claimedBy?: string | null;
  closedAt?: string | null;
  closedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Toegestane statusovergangen. Een ticket mag heropend worden (DONE → OPEN)
 * omdat een klant terug kan komen op iets dat afgehandeld leek; alleen
 * CANCELLED is een eindpunt.
 */
const TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = Object.freeze({
  OPEN: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
  IN_PROGRESS: ['OPEN', 'DONE', 'CANCELLED'],
  DONE: ['OPEN'],
  CANCELLED: [],
});

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

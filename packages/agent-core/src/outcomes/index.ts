/**
 * De vier uitkomsten — Kennis, Systeem, Taak, Onbekend (bouwbriefing §3).
 *
 * ## Twee assen, niet één
 *
 * De router kiest twee dingen die los van elkaar staan:
 *
 *   uitkomst    → wát er met het bericht gebeurt (antwoorden, ticket, doorvragen)
 *   specialist  → wíe de tekst schrijft (simple_reply, complaint, technical, …)
 *
 * "Waar is mijn pakket" is uitkomst `systeem` met specialist `simple_reply`.
 * "Mijn pakket is kapot" is uitkomst `taak` met specialist `complaint`. De
 * uitkomst bepaalt de route, de specialist de toon en de tool-scope.
 *
 * ## Waarom de uitkomst pas ná de tool-calls vaststaat
 *
 * `systeem` mag alleen automatisch als de klant geïdentificeerd is én er
 * daadwerkelijk een systeemantwoord terugkomt. Dat weet je niet in de router —
 * dat blijkt pas als de ERP-call is gedaan. De router zet daarom een
 * **voorlopige** uitkomst; `finalizeOutcome()` maakt 'm definitief en
 * degradeert `systeem` naar `taak` als een van beide voorwaarden ontbreekt.
 *
 * Die degradatie is expliciet en testbaar gemaakt in plaats van iets wat de
 * plan-stap stilzwijgend doet — anders ontdek je pas in productie dat de agent
 * een leverdatum heeft verzonnen omdat de lookup leeg terugkwam.
 */

import type { ChannelId } from '../channels/index.js';

export type Outcome = 'kennis' | 'systeem' | 'taak' | 'onbekend';

export interface OutcomeDecision {
  outcome: Outcome;
  /** Waarom deze uitkomst. Gaat naar het beslislog, nooit naar de klant. */
  reason: string;
  /** Gezet als `finalizeOutcome` de voorlopige uitkomst heeft verlaagd. */
  degradedFrom?: Outcome;
}

/**
 * Wat er ná de tool-calls bekend is. Alleen deze twee feiten bepalen of
 * `systeem` overeind blijft.
 */
export interface OutcomeEvidence {
  /** Is de klant geïdentificeerd volgens het beleid van dit kanaal? */
  identified: boolean;
  /**
   * Kwam er daadwerkelijk een systeemantwoord terug — een order, een status,
   * een tracking? Een geslaagde call die niets vond, is `false`.
   */
  systemAnswer: boolean;
}

// ---------------------------------------------------------------------------
// Identificatie — per kanaal, want de omstandigheden verschillen wezenlijk.
// ---------------------------------------------------------------------------

export interface IdentificationPolicy {
  /**
   * Volstaat het afzenderadres dat het kanaal zelf aanlevert?
   *
   * Bij mail: ja. Het adres komt van het mailsysteem en niet van een
   * formulierveld, en elk uitgaand antwoord gaat langs een mens — een verkeerde
   * match wordt daar gezien voordat er iets de deur uitgaat.
   *
   * Bij chat: nee. De bezoeker is anoniem, typt zelf wat hij wil, en het
   * antwoord gaat direct naar buiten. Daar hoort de identificatiestap uit
   * bouwbriefing §4 (mailadres + ordernummer) vóór.
   */
  senderAddressSuffices: boolean;
  /** Moet er een ordernummer bij, ook als het adres bekend is? */
  requiresOrderReference: boolean;
}

export const IDENTIFICATION: Readonly<Record<string, IdentificationPolicy>> =
  Object.freeze({
    mail: { senderAddressSuffices: true, requiresOrderReference: false },
    chat: { senderAddressSuffices: false, requiresOrderReference: true },
  });

/** Onbekend kanaal → de strengste variant. Nooit stilzwijgend soepeler worden. */
export function identificationPolicy(channel: ChannelId): IdentificationPolicy {
  return (
    IDENTIFICATION[channel] ?? {
      senderAddressSuffices: false,
      requiresOrderReference: true,
    }
  );
}

export interface IdentityInput {
  /** Afzender zoals het kanaal 'm aanlevert (mail: From; chat: opgegeven). */
  senderAddress?: string | null;
  /** Ordernummer uit het bericht of uit de identificatiestap. */
  orderReference?: string | null;
}

/** Toetst de identiteit aan het beleid van dit kanaal. */
export function isIdentified(channel: ChannelId, input: IdentityInput): boolean {
  const policy = identificationPolicy(channel);
  const hasAddress = Boolean(input.senderAddress?.trim());
  const hasOrder = Boolean(input.orderReference?.trim());

  if (policy.requiresOrderReference && !hasOrder) return false;
  if (policy.senderAddressSuffices) return hasAddress || hasOrder;
  return hasAddress && hasOrder;
}

// ---------------------------------------------------------------------------
// De degradatie
// ---------------------------------------------------------------------------

/**
 * Maakt de voorlopige uitkomst definitief.
 *
 * Alleen `systeem` kan degraderen. `kennis` komt uit de kennisbasis en heeft
 * geen systeemantwoord nodig; `taak` en `onbekend` gaan sowieso niet
 * automatisch de deur uit.
 */
export function finalizeOutcome(
  provisional: Outcome,
  evidence: OutcomeEvidence,
): OutcomeDecision {
  if (provisional !== 'systeem') {
    return { outcome: provisional, reason: `router koos ${provisional}` };
  }

  if (!evidence.identified) {
    return {
      outcome: 'taak',
      degradedFrom: 'systeem',
      reason: 'geen bevestigde identificatie — systeemantwoord niet toegestaan',
    };
  }

  if (!evidence.systemAnswer) {
    return {
      outcome: 'taak',
      degradedFrom: 'systeem',
      reason: 'geen systeemantwoord uit de bron — niet gokken',
    };
  }

  return { outcome: 'systeem', reason: 'geïdentificeerd én systeemantwoord aanwezig' };
}

// ---------------------------------------------------------------------------
// Wat een uitkomst betekent voor de route
// ---------------------------------------------------------------------------

export interface OutcomeRouting {
  /** Mag dit zonder mens naar buiten? Bij chat de enige vraag die telt. */
  mayAutoRespond: boolean;
  /** Levert dit een ticket op in de werkbak? */
  createsTicket: boolean;
  /** Vraagt de agent door in plaats van te antwoorden of te ticketen? */
  asksFollowUp: boolean;
}

/**
 * Let op `onbekend`: dat wordt **geen** ticket. Anders maakt de agent taken van
 * gesprekken die geen taak zijn en loopt de werkbak vol met ruis — precies het
 * probleem dat we willen oplossen. Bij onbekend vraagt de agent door, en pas
 * als dat geen categorie oplevert draagt hij over aan een mens.
 */
export const OUTCOME_ROUTING: Readonly<Record<Outcome, OutcomeRouting>> =
  Object.freeze({
    kennis: { mayAutoRespond: true, createsTicket: false, asksFollowUp: false },
    systeem: { mayAutoRespond: true, createsTicket: false, asksFollowUp: false },
    taak: { mayAutoRespond: false, createsTicket: true, asksFollowUp: false },
    onbekend: { mayAutoRespond: false, createsTicket: false, asksFollowUp: true },
  });

export function routingFor(outcome: Outcome): OutcomeRouting {
  return OUTCOME_ROUTING[outcome];
}

/**
 * Mag de agent op dit kanaal zelf antwoorden?
 *
 * Bij mail nooit zonder mens: harde regel 1 uit CLAUDE.md geldt onverkort, dus
 * ook `kennis` en `systeem` worden een concept in de werkbak. Bij chat staat er
 * iemand te wachten en is de beleidslaag het enige wat ertussen staat — daar
 * mogen `kennis` en `systeem` direct.
 */
export function mayRespondWithoutHuman(channel: ChannelId, outcome: Outcome): boolean {
  if (channel === 'mail') return false;
  return routingFor(outcome).mayAutoRespond;
}

// ---------------------------------------------------------------------------
// Terugval als de router geen uitkomst noemt
// ---------------------------------------------------------------------------

/**
 * Leidt een uitkomst af uit de specialist en de geëxtraheerde velden, voor het
 * geval de router er zelf geen noemt (oude prompt, kapotte JSON).
 *
 * Bewust conservatief: alles waar een mens iets mee moet, wordt `taak`. Alleen
 * `simple_reply` mag `kennis` of `systeem` worden, en `systeem` uitsluitend als
 * er een ordernummer in het bericht stond — anders valt er niets op te zoeken
 * en is het een kennisvraag.
 */
export function outcomeFromClassification(input: {
  specialist?: string;
  extracted?: Record<string, unknown>;
}): Outcome {
  const orderRef = input.extracted?.orderNumber;
  const hasOrder = typeof orderRef === 'string' && orderRef.trim().length > 0;

  switch (input.specialist) {
    case 'simple_reply':
      return hasOrder ? 'systeem' : 'kennis';
    case 'escalate':
      // De router kon niet classificeren. Dat is precies `onbekend`:
      // doorvragen of overdragen, géén ticket.
      return 'onbekend';
    case 'order_change':
    case 'complaint':
    case 'technical':
    case 'gdpr':
      return 'taak';
    default:
      // Onbekende of ontbrekende specialist: naar een mens, niet gokken.
      return 'taak';
  }
}

/** De vier geldige waarden — voor validatie van LLM-output. */
export const OUTCOMES: readonly Outcome[] = Object.freeze([
  'kennis',
  'systeem',
  'taak',
  'onbekend',
]);

export function isOutcome(value: unknown): value is Outcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);
}

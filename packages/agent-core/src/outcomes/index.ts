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
   * Hangt af van hoe betrouwbaar dat adres is en van wat er misgaat bij een
   * verkeerde match. Het pakket vult 'm in per kanaal; zie
   * `modules/klantenservice/outcomes.ts` voor de afweging bij mail en chat.
   */
  senderAddressSuffices: boolean;
  /** Moet er een referentie (ordernummer, dossier) bij, ook bij een bekend adres? */
  requiresOrderReference: boolean;
}

/**
 * Het beleid van dit kanaal, of de strengste variant als de module er geen
 * noemt.
 *
 * Onbekend kanaal wordt nooit stilzwijgend soepeler: dat zou betekenen dat een
 * nieuw kanaal zonder afspraak meteen op de losse manier identificeert.
 */
export function identificationPolicy(
  policies: Readonly<Partial<Record<ChannelId, IdentificationPolicy>>>,
  channel: ChannelId,
): IdentificationPolicy {
  return (
    policies[channel] ?? {
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

/**
 * Toetst de identiteit aan het beleid van dit kanaal.
 *
 * Het beleid komt van het modulepakket (`pack.outcomes.identification`) en niet
 * uit een globale tabel: wat "geïdentificeerd" betekent verschilt per proces.
 */
export function isIdentified(
  policies: Readonly<Partial<Record<ChannelId, IdentificationPolicy>>>,
  channel: ChannelId,
  input: IdentityInput,
): boolean {
  const policy = identificationPolicy(policies, channel);
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

/**
 * Feedback-gedreven few-shot referentie (Build Document — master). Een
 * ReviewItem-beslissing wordt een gewone MemoryEntry(scope=PROCESS,
 * source="feedback"): GOOD om na te streven, BAD om te vermijden. Few-shot
 * only — GEEN finetuning. Voorbeelden blijven intrekbaar + herleidbaar
 * (gewone rows, met sourceRef = reviewItem.id).
 *
 * Deze laag is puur (geen embeddings/DB): hij mapt een beslissing op het
 * MemoryEntry-skelet en formatteert few-shot-blokken. Embeddings + opslag
 * gebeuren in de app/Workflow-laag.
 */

import type { MemoryEntry, MemoryLabel, ReviewItem } from '../contracts/index.js';

export type FeedbackDecision = 'APPROVED' | 'EDITED' | 'REJECTED';

export interface FeedbackInput {
  reviewItem: Pick<ReviewItem, 'id' | 'organizationId' | 'summary'>;
  decision: FeedbackDecision;
  /** Verzonden versie (APPROVED) of gecorrigeerde versie (EDITED). */
  finalBody?: string;
  /** Oorspronkelijke draft vóór correctie (EDITED), of de afgewezen draft (REJECTED). */
  originalDraft?: string;
  /** Reden bij REJECTED, indien aanwezig. */
  reason?: string;
}

/** Het deel van een MemoryEntry dat uit de beslissing volgt (zonder id/embedding/createdAt). */
export type FeedbackMemoryDraft = Omit<MemoryEntry, 'id' | 'embedding' | 'createdAt'>;

/**
 * Bouwt het MemoryEntry-skelet uit een beslissing. Geeft `null` terug als er
 * niets te leren valt (geen body/draft) — dan schrijven we geen voorbeeld.
 */
export function buildFeedbackMemory(input: FeedbackInput): FeedbackMemoryDraft | null {
  const { reviewItem, decision } = input;
  const base = {
    organizationId: reviewItem.organizationId,
    scope: 'PROCESS' as const,
    pinned: false,
    source: 'feedback',
    sourceRef: reviewItem.id,
    contactId: null,
    dealId: null,
    projectId: null,
  };

  if (decision === 'APPROVED') {
    if (!input.finalBody) return null;
    return {
      ...base,
      label: 'GOOD',
      supersededDraft: null,
      title: `GOEDGEKEURD — ${reviewItem.summary}`,
      body: input.finalBody,
    };
  }

  if (decision === 'EDITED') {
    if (!input.finalBody) return null;
    return {
      ...base,
      label: 'GOOD',
      // De diff origineel↔correctie is het primaire signaal.
      supersededDraft: input.originalDraft ?? null,
      title: `GECORRIGEERD — ${reviewItem.summary}`,
      body: input.finalBody,
    };
  }

  // REJECTED
  if (!input.originalDraft) return null;
  const reason = input.reason?.trim();
  return {
    ...base,
    label: 'BAD',
    supersededDraft: null,
    title: `AFGEWEZEN — ${reviewItem.summary}`,
    body: reason ? `${input.originalDraft}\n\nReden afwijzing: ${reason}` : input.originalDraft,
  };
}

/** Eén few-shot voorbeeld zoals de retrieve-stap het teruggeeft. */
export interface FewShotExample {
  label?: MemoryLabel | null;
  body: string;
  supersededDraft?: string | null;
}

/**
 * Formatteert opgehaalde voorbeelden tot een few-shot-blok voor de planning-
 * prompt: GOOD → "eerder goedgekeurd", BAD → "vermijd". Bij een EDIT-voorbeeld
 * tonen we ook de afgekeurde versie zodat het model de correctie ziet.
 */
export function buildFewShotBlock(examples: FewShotExample[]): string {
  if (examples.length === 0) return '';
  const good = examples.filter((e) => e.label !== 'BAD');
  const bad = examples.filter((e) => e.label === 'BAD');

  const parts: string[] = [];
  if (good.length) {
    parts.push(
      'Eerder goedgekeurd (stijl/aanpak nastreven):\n' +
        good
          .map((e, i) => {
            const corr = e.supersededDraft
              ? `\n  (afgekeurde versie was: ${e.supersededDraft})`
              : '';
            return `${i + 1}. ${e.body}${corr}`;
          })
          .join('\n'),
    );
  }
  if (bad.length) {
    parts.push(
      'Vermijd (eerder afgewezen):\n' + bad.map((e, i) => `${i + 1}. ${e.body}`).join('\n'),
    );
  }
  return parts.join('\n\n');
}

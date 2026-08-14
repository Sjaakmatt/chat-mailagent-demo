/**
 * Poller-lus (Build Document A4/§4 — "de seam"). Een DO-alarm of Cron-Worker
 * gebruikt dit om de pgmq-queue te overbruggen naar de Orchestration-Workflow:
 *
 *   1. lees een batch uit pgmq (messages worden invisible via visibility timeout)
 *   2. start per message een Workflow met idempotency-key = msg_id (dubbele
 *      start = no-op)
 *   3. archiveer de pgmq-message pas ná succesvolle start
 *
 * Resultaat: pgmq garandeert "niet verloren" (at-least-once intake), de Workflow
 * garandeert "exact één effect" (idempotent). Faalt een start, dan archiveren we
 * niet → de message komt na de visibility timeout terug.
 */

import type { ISignalConsumer, QueuedSignal } from '../signals/index.js';

/**
 * Start de Orchestration-Workflow voor één gequeued signaal. De implementatie
 * MOET de meegegeven idempotency-key (= msgId) als Workflow-id/instance-key
 * gebruiken, zodat een dubbele start een no-op is.
 */
export type StartWorkflow = (job: {
  msgId: number;
  signalId: string;
  idempotencyKey: string;
}) => Promise<void>;

export interface PollOptions {
  /** Max messages per poll (default 10). */
  count?: number;
  /** Visibility timeout in seconden (default 60). */
  vtSeconds?: number;
}

export interface PollResult {
  read: number;
  started: number;
  archived: number;
  failures: number;
}

/**
 * Eén poll-cyclus. Verwerkt elke message onafhankelijk: een falende start stopt
 * de batch niet, maar laat die ene message ongearchiveerd (komt terug).
 */
export async function runPoll(
  consumer: ISignalConsumer,
  start: StartWorkflow,
  opts: PollOptions = {},
): Promise<PollResult> {
  const messages = await consumer.read({
    count: opts.count ?? 10,
    vtSeconds: opts.vtSeconds ?? 60,
  });

  const result: PollResult = {
    read: messages.length,
    started: 0,
    archived: 0,
    failures: 0,
  };

  for (const msg of messages) {
    try {
      await startOne(consumer, start, msg, result);
    } catch {
      // Start of archivering faalde → niet archiveren. Na de visibility timeout
      // komt de message terug (read_ct stijgt), zodat niets stil verdwijnt.
      result.failures += 1;
    }
  }

  return result;
}

async function startOne(
  consumer: ISignalConsumer,
  start: StartWorkflow,
  msg: QueuedSignal,
  result: PollResult,
): Promise<void> {
  await start({
    msgId: msg.msgId,
    signalId: msg.signalId,
    idempotencyKey: String(msg.msgId),
  });
  result.started += 1;
  // Archiveer pas ná succesvolle start.
  if (await consumer.archive(msg.msgId)) {
    result.archived += 1;
  }
}

export interface BackoffOptions {
  minMs: number;
  maxMs: number;
  /** Vermenigvuldigingsfactor per lege poll (default 2). */
  factor?: number;
}

/**
 * Berekent het volgende poll-interval. Bij werk: terug naar `minMs` (snel weer
 * pollen). Bij een lege queue: exponentieel oplopen tot `maxMs` — te frequent
 * pollen knabbelt aan scale-to-zero en zet load op Supabase.
 */
export function nextPollDelayMs(
  lastResult: PollResult,
  currentDelayMs: number,
  opts: BackoffOptions,
): number {
  const factor = opts.factor ?? 2;
  if (lastResult.read > 0) return opts.minMs;
  const grown = Math.max(opts.minMs, currentDelayMs) * factor;
  return Math.min(grown, opts.maxMs);
}

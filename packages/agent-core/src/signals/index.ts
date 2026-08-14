/**
 * Signal-consume: de intake-kant van de work-bus (REFERENCE_ARCHITECTURE §4).
 * De DO-alarm/Cron-poller leest met deze primitive work items uit de
 * `aios_signals`-pgmq-queue, start per item de orchestrator-Workflow, en
 * archiveert de message pas ná succesvolle start.
 *
 * Net als de emitter praat dit via PostgREST met de **platform**-Supabase, via
 * SECURITY DEFINER-RPC's (`aios_read_signals` / `aios_archive_signal`) zodat de
 * Worker geen directe pgmq-grants nodig heeft. (Hyperdrive + directe SQL is het
 * latere alternatief; voor nu houden we de emit/consume-kant symmetrisch.)
 */

import { SupabaseClient } from '../supabase/index.js';
import type { TenantContext } from '../tenant/index.js';
import { ServiceRoleCredentialStore } from '../tenant/index.js';

export const AIOS_READ_SIGNALS_FN = 'aios_read_signals';
export const AIOS_ARCHIVE_SIGNAL_FN = 'aios_archive_signal';

/** Platform-context voor de pgmq-RPC-calls (de queue is niet tenant-scoped). */
const PLATFORM_CTX: TenantContext = {
  organizationId: '_platform',
  agentId: 'aios-pgmq-consumer',
  toolCallId: 'aios-pgmq-consumer',
};

export interface QueuedSignal {
  /** pgmq message-id; tevens de idempotency-key voor de Workflow-start. */
  msgId: number;
  /** Hoe vaak deze message al gelezen is (>1 ⇒ een eerdere verwerking faalde). */
  readCount: number;
  enqueuedAt: string | null;
  /** signalId uit de message-body (verwijst naar de Signal-tabel). */
  signalId: string;
}

export interface ReadOptions {
  /** Max aantal messages per poll (default 10). */
  count?: number;
  /**
   * Visibility timeout in seconden: hoe lang een gelezen message onzichtbaar
   * blijft voor andere pollers (default 60). Lang genoeg om de Workflow te
   * starten; verloopt 'ie, dan komt de message terug (at-least-once).
   */
  vtSeconds?: number;
}

export interface ISignalConsumer {
  read(opts?: ReadOptions): Promise<QueuedSignal[]>;
  /** Archiveert een verwerkte message. `true` = gearchiveerd. */
  archive(msgId: number): Promise<boolean>;
}

/** Rij zoals `aios_read_signals` (RETURNS TABLE) via PostgREST teruggeeft. */
interface ReadRow {
  msg_id: number | string;
  read_ct: number;
  enqueued_at: string | null;
  message: { signalId?: string } | null;
}

export interface ServiceRoleConsumerConfig {
  /** REST-URL van de platform-Supabase. */
  projectUrl: string;
  /** Service-role-key van de platform-Supabase. */
  serviceRoleKey: string;
  schema?: string;
}

/**
 * pgmq-consumer bovenop de gedeelde PostgREST-`SupabaseClient`: hergebruikt
 * diens retry/backoff + foutafhandeling, gericht op de platform-DB.
 */
export class PgmqSignalConsumer implements ISignalConsumer {
  constructor(private readonly client: SupabaseClient) {}

  static fromServiceRole(config: ServiceRoleConsumerConfig): PgmqSignalConsumer {
    return new PgmqSignalConsumer(
      new SupabaseClient(new ServiceRoleCredentialStore(config.serviceRoleKey), {
        projectUrl: config.projectUrl,
        schema: config.schema,
      }),
    );
  }

  async read(opts: ReadOptions = {}): Promise<QueuedSignal[]> {
    const rows = await this.client.request<ReadRow[]>(
      PLATFORM_CTX,
      this.client.rpcUrl(AIOS_READ_SIGNALS_FN),
      {
        method: 'POST',
        body: JSON.stringify({
          p_count: opts.count ?? 10,
          p_vt: opts.vtSeconds ?? 60,
        }),
      },
    );
    if (!Array.isArray(rows)) return [];

    const out: QueuedSignal[] = [];
    for (const row of rows) {
      const signalId = row.message?.signalId;
      if (typeof signalId !== 'string' || signalId.length === 0) {
        // Defensief: een message zonder signalId hoort hier niet. Niet
        // archiveren → na de visibility timeout komt 'ie terug (read_ct stijgt),
        // zodat het zichtbaar blijft i.p.v. stil te verdwijnen.
        continue;
      }
      out.push({
        msgId: Number(row.msg_id),
        readCount: row.read_ct,
        enqueuedAt: row.enqueued_at,
        signalId,
      });
    }
    return out;
  }

  async archive(msgId: number): Promise<boolean> {
    const result = await this.client.request<boolean>(
      PLATFORM_CTX,
      this.client.rpcUrl(AIOS_ARCHIVE_SIGNAL_FN),
      { method: 'POST', body: JSON.stringify({ p_msg_id: msgId }) },
    );
    return result === true;
  }
}

/**
 * In-memory consumer voor unit-tests/demo: een simpele queue met archivering.
 * Geen netwerk, geen DB.
 */
export class InMemorySignalConsumer implements ISignalConsumer {
  private readonly queue: QueuedSignal[] = [];
  public readonly archived: number[] = [];
  private seq = 0;

  /** Test-helper: voeg een signalId toe aan de queue. Geeft de msgId terug. */
  enqueue(signalId: string): number {
    const msgId = ++this.seq;
    this.queue.push({
      msgId,
      readCount: 1,
      enqueuedAt: new Date().toISOString(),
      signalId,
    });
    return msgId;
  }

  async read(opts: ReadOptions = {}): Promise<QueuedSignal[]> {
    const count = opts.count ?? 10;
    return this.queue
      .filter((m) => !this.archived.includes(m.msgId))
      .slice(0, count);
  }

  async archive(msgId: number): Promise<boolean> {
    if (this.archived.includes(msgId)) return false;
    if (!this.queue.some((m) => m.msgId === msgId)) return false;
    this.archived.push(msgId);
    return true;
  }
}

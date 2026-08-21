/**
 * Signalen op de bus zetten — één plek, voor elke intake.
 *
 * De webhook-route, de cron en het uploadpad doen allemaal hetzelfde: een
 * gebeurtenis omzetten in een `Signal(NEW)` en die in dezelfde transactie in
 * pgmq zetten. Dat is de transactional outbox uit migratie 0002, en het is het
 * enige wat een intake mag doen. Verwerken gebeurt verderop, in de lus.
 *
 * Drie keer dezelfde RPC-aanroep uitschrijven is drie kansen om de
 * idempotency-sleutel te vergeten, en dan staat er bij elke retry een dubbel
 * voorstel in de werkbak.
 */

import { ServiceRoleCredentialStore, SupabaseClient } from '@factumai/agent-core';
import type { Env } from '../env.js';

export interface EmitInput {
  /** mail | chat | schedule | document | <webhookbron> */
  domain: string;
  /** `<domein>.<gebeurtenis>`, bv. `schedule.ticket_opvolging`. */
  type: string;
  payload: Record<string, unknown>;
  /**
   * De sleutel waarop de bus ontdubbelt.
   *
   * **Altijd invullen.** Elke intake in dit systeem kan opnieuw draaien: een
   * cron die twee keer tikt, een bron die zijn webhook herhaalt, een Workflow
   * die een step hervat. Zonder sleutel levert elke herhaling een tweede
   * signaal op, en dus een tweede voorstel voor dezelfde gebeurtenis.
   */
  idempotencyKey: string;
}

export interface EmitResult {
  signalId: string | null;
  /** False als de sleutel al bestond — dan is er niets nieuws op de bus gezet. */
  enqueued: boolean;
}

/** Een tenant-scoped client op de klant-Supabase. */
export function intakeClient(env: Env): SupabaseClient {
  return new SupabaseClient(
    new ServiceRoleCredentialStore(env.AIOS_SUPABASE_SERVICE_ROLE_KEY),
    { projectUrl: env.AIOS_SUPABASE_URL },
  );
}

/** De tenant-context voor een intake. De agent heeft geen rol; zie docs/RECHTEN.md. */
export function intakeCtx(env: Env) {
  return {
    organizationId: env.AIOS_ORG_ID,
    agentId: 'aios-agent',
    toolCallId: 'aios-intake',
  };
}

/**
 * Zet één signaal op de bus.
 *
 * Geeft terug of er daadwerkelijk iets is bijgekomen. `enqueued: false` is geen
 * fout maar het normale antwoord op een herhaling — een aanroeper die dat als
 * mislukking behandelt, laat een bron eindeloos opnieuw proberen.
 */
export async function emitSignal(
  env: Env,
  input: EmitInput,
  client = intakeClient(env),
): Promise<EmitResult> {
  const rijen = await client.request<Array<{ signal_id?: string; enqueued?: boolean }>>(
    intakeCtx(env),
    client.rpcUrl('aios_emit_signal'),
    {
      method: 'POST',
      body: JSON.stringify({
        p_org: env.AIOS_ORG_ID,
        p_domain: input.domain,
        p_type: input.type,
        p_payload: input.payload,
        p_idempotency_key: input.idempotencyKey,
      }),
    },
  );

  const rij = Array.isArray(rijen) ? rijen[0] : undefined;
  return {
    signalId: rij?.signal_id ?? null,
    enqueued: rij?.enqueued === true,
  };
}

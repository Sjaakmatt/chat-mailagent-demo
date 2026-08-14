-- AIOS work-bus (Build Document A4): pgmq-queue + de SECURITY
-- DEFINER-RPC's die @factumai/shared/signals gebruikt (emit/read/archive).
-- Doel-DB: het Supabase-project van de klant. Symmetrisch met de bestaande
-- aios_* RPC's, maar gericht op public.aios_signals (snake_case) uit migratie 0001.
--
-- De transactional outbox: aios_emit_signal schrijft Signal(NEW) + enqueuet
-- {signalId} in pgmq in één transactie; idempotent op idempotency_key.

create extension if not exists pgmq;

-- Queue aanmaken (idempotent).
do $$ begin
  perform pgmq.create('aios_signals');
exception when others then null; end $$;

create or replace function public.aios_emit_signal(
  p_org text,
  p_domain text,
  p_type text,
  p_payload jsonb,
  p_idempotency_key text
) returns table(signal_id text, enqueued boolean)
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_id text;
  v_existing text;
begin
  if p_idempotency_key is not null then
    select id into v_existing
      from public.aios_signals
      where idempotency_key = p_idempotency_key;
    if v_existing is not null then
      signal_id := v_existing; enqueued := false; return next; return;
    end if;
  end if;

  v_id := 'sig_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.aios_signals (id, organization_id, domain, type, payload, status, idempotency_key)
    values (v_id, p_org, p_domain, p_type, coalesce(p_payload, '{}'::jsonb), 'NEW', p_idempotency_key);

  perform pgmq.send('aios_signals', jsonb_build_object('signalId', v_id));

  signal_id := v_id; enqueued := true; return next;
end $$;

create or replace function public.aios_read_signals(p_count int, p_vt int)
returns table(msg_id bigint, read_ct int, enqueued_at timestamptz, message jsonb)
language sql
security definer
set search_path = public, pgmq
as $$
  select msg_id, read_ct, enqueued_at, message
  from pgmq.read('aios_signals', p_vt, p_count);
$$;

create or replace function public.aios_archive_signal(p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.archive('aios_signals', p_msg_id);
$$;

-- Alleen de service-role (Worker/MCP) mag de bus aanspreken; niet anon/authenticated.
revoke all on function public.aios_emit_signal(text, text, text, jsonb, text) from public;
revoke all on function public.aios_read_signals(int, int) from public;
revoke all on function public.aios_archive_signal(bigint) from public;
grant execute on function public.aios_emit_signal(text, text, text, jsonb, text) to service_role;
grant execute on function public.aios_read_signals(int, int) to service_role;
grant execute on function public.aios_archive_signal(bigint) to service_role;

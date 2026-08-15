-- Feedback-gedreven few-shot + RAG (Build Document A8/master). pgvector aan,
-- label + superseded_draft op aios_memory_entries, hnsw-index, en een
-- similarity-RPC. Doel-DB: het klant-project. embedding gaat van jsonb naar
-- vector(1024) (tabel is leeg → drop+add veilig).

create extension if not exists vector;

do $$ begin
  create type aios_memory_label as enum ('GOOD','BAD');
exception when duplicate_object then null; end $$;

alter table public.aios_memory_entries add column if not exists label aios_memory_label;
alter table public.aios_memory_entries add column if not exists superseded_draft text;

alter table public.aios_memory_entries drop column if exists embedding;
alter table public.aios_memory_entries add column embedding vector(1024);

create index if not exists aios_memory_entries_embedding_idx
  on public.aios_memory_entries using hnsw (embedding vector_cosine_ops);
create index if not exists aios_memory_entries_org_label_idx
  on public.aios_memory_entries (organization_id, label);

-- Similarity-match (cosine). p_embedding komt als text-literal binnen en wordt
-- naar vector gecast (PostgREST-vriendelijk). Hogere similarity = dichterbij.
create or replace function public.aios_match_memory(
  p_org text,
  p_embedding text,
  p_scope text,
  p_label text,
  p_limit int
) returns table(
  id text,
  title text,
  body text,
  label text,
  superseded_draft text,
  pinned boolean,
  similarity double precision
)
language sql
security definer
set search_path = public
as $$
  select
    id, title, body, label::text, superseded_draft, pinned,
    1 - (embedding <=> p_embedding::vector) as similarity
  from public.aios_memory_entries
  where organization_id = p_org
    and deleted_at is null
    and embedding is not null
    and (p_scope is null or scope::text = p_scope)
    and (p_label is null or label::text = p_label)
  order by embedding <=> p_embedding::vector
  limit greatest(p_limit, 1);
$$;

-- Zie 0002: `from public` haalt de default EXECUTE-grants van anon/authenticated
-- niet weg. Zonder die twee erbij kan iedereen met de anon-key de memory van
-- elke tenant uitlezen — de functie is SECURITY DEFINER en neemt p_org als
-- parameter, dus RLS beschermt hier niets.
revoke all on function public.aios_match_memory(text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.aios_match_memory(text, text, text, text, int) to service_role;

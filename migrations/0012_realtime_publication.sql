-- 0012_realtime_publication
-- Supabase Realtime i.p.v. polling voor de cockpit: de werkbak (review-items)
-- en de magazijnbak (shipment-tasks) ververst zichzelf zodra er een rij
-- verandert. Realtime postgres_changes worden alleen geleverd aan ingelogde
-- gebruikers als (a) de tabel in de `supabase_realtime`-publicatie zit en
-- (b) er een SELECT-policy voor `authenticated` is (Realtime autoriseert via
-- RLS). De server blijft met de service-role lezen/schrijven (bypasst RLS),
-- dus de API-routes en de agent veranderen niet. Anon (geen JWT) krijgt niets.

-- aios_shipment_tasks had nog geen RLS — aanzetten en authenticated laten lezen.
alter table public.aios_shipment_tasks enable row level security;

drop policy if exists "authenticated read shipment tasks" on public.aios_shipment_tasks;
create policy "authenticated read shipment tasks"
  on public.aios_shipment_tasks for select to authenticated using (true);

-- aios_review_items heeft RLS al aan maar nog geen leespolicy.
drop policy if exists "authenticated read review items" on public.aios_review_items;
create policy "authenticated read review items"
  on public.aios_review_items for select to authenticated using (true);

-- Beide tabellen aan de realtime-publicatie toevoegen (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'aios_review_items'
  ) then
    alter publication supabase_realtime add table public.aios_review_items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'aios_shipment_tasks'
  ) then
    alter publication supabase_realtime add table public.aios_shipment_tasks;
  end if;
end $$;

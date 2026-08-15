-- 0021_revoke_security_definer
-- Beveiligingsfix voor databases die al vóór deze migratie zijn opgezet.
--
-- 0002, 0003 en 0020 maken SECURITY DEFINER-RPC's en probeerden ze af te
-- schermen met `revoke all ... from public`. Dat is niet genoeg. Supabase zet
-- default privileges op schema `public` die élke nieuwe functie een eigen
-- EXECUTE-grant geven aan `anon` en `authenticated`. Een revoke op de
-- PUBLIC-pseudorol raakt die aparte grants niet, dus bleven ze staan.
--
-- Wat dat betekende, met een anon-key die per definitie publiek is (de cockpit
-- levert 'm mee voor Supabase Auth):
--
--   aios_emit_signal        signalen injecteren voor een wíllekeurige
--                           organization_id — de agent verwerkt ze, roept het
--                           model aan en zet ReviewItems in andermans werkbak.
--   aios_read_signals       de work-bus uitlezen én leegtrekken: gelezen
--                           berichten worden onzichtbaar voor de echte poller.
--   aios_archive_signal     berichten wegarchiveren vóór verwerking.
--   aios_match_memory       memory van elke tenant uitlezen. De functie neemt
--                           p_org als parameter en draait als definer, dus RLS
--                           beschermt hier niets.
--   aios_next_ticket_number ticketnummers verbranden bij een andere tenant.
--
-- 0002/0003/0020 zijn ook zelf gecorrigeerd, zodat een verse database het
-- meteen goed heeft. Deze migratie is voor de databases die er al stonden.
-- Idempotent: opnieuw draaien verandert niets.

revoke all on function public.aios_emit_signal(text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.aios_read_signals(int, int) from public, anon, authenticated;
revoke all on function public.aios_archive_signal(bigint) from public, anon, authenticated;
revoke all on function public.aios_match_memory(text, text, text, text, int) from public, anon, authenticated;
revoke all on function public.aios_next_ticket_number(text, text, text) from public, anon, authenticated;

grant execute on function public.aios_emit_signal(text, text, text, jsonb, text) to service_role;
grant execute on function public.aios_read_signals(int, int) to service_role;
grant execute on function public.aios_archive_signal(bigint) to service_role;
grant execute on function public.aios_match_memory(text, text, text, text, int) to service_role;
grant execute on function public.aios_next_ticket_number(text, text, text) to service_role;

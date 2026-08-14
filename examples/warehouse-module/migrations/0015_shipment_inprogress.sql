-- 0015_shipment_inprogress
-- Magazijn-werkflow: drie statussen i.p.v. twee (nieuw → in behandeling →
-- verstuurd). Plus claim-audit (wie heeft hem opgepakt, wanneer) zodat we
-- in de tijdlijn kunnen tonen "Opgepakt door X · Verstuurd door Y".
--
-- 'OPEN'        = nieuw, niemand mee bezig
-- 'IN_PROGRESS' = iemand heeft 'm geclaimd, bezig met picken
-- 'DONE'        = pakket verstuurd (completed_by/completed_at)
-- 'CANCELLED'   = blijft bestaan voor edge-cases

alter table public.aios_shipment_tasks
  drop constraint if exists aios_shipment_tasks_status_check;

alter table public.aios_shipment_tasks
  add constraint aios_shipment_tasks_status_check
  check (status in ('OPEN','IN_PROGRESS','DONE','CANCELLED'));

alter table public.aios_shipment_tasks
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by text;

comment on column public.aios_shipment_tasks.claimed_by is
  'E-mail van de magazijn-medewerker die de taak heeft opgepakt (IN_PROGRESS).';
comment on column public.aios_shipment_tasks.claimed_at is
  'Tijdstip dat de taak op IN_PROGRESS is gezet.';

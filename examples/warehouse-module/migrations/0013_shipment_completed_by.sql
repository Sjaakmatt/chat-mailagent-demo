-- 0013_shipment_completed_by
-- Audit-trail voor afgehandelde verzendtaken: wie heeft 'm DONE gemaakt?
-- (Het ReviewItem-equivalent is aios_review_items.decided_by — daar staan
-- approve/edit/reject; voor magazijn loggen we 'completed_by' bij DONE.)

alter table public.aios_shipment_tasks
  add column if not exists completed_by text;

comment on column public.aios_shipment_tasks.completed_by is
  'E-mail van de cockpit-gebruiker die de verzendtaak op DONE heeft gezet.';

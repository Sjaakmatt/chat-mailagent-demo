-- 0006_review_decided_by
-- Legt vast wie een ReviewItem besliste (approve/edit/reject), zodat de
-- cockpit-auditlog een actor kan tonen. Nullable: bestaande rijen + het
-- autonome pad hebben geen menselijke beslisser.

alter table public.aios_review_items
  add column if not exists decided_by text;

comment on column public.aios_review_items.decided_by is
  'E-mail van de reviewer die besliste (cockpit). Null voor onbesliste of autonome items.';

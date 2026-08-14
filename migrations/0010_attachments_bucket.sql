-- 0010_attachments_bucket
-- Private Storage-bucket voor mail-bijlagen. De agent uploadt bijlagen tijdens
-- hydratatie (service-role); de cockpit serveert ze via tijdelijke signed URLs
-- (ook service-role). Geen publieke toegang; geen extra RLS-policies nodig omdat
-- beide kanten de service-role gebruiken.

insert into storage.buckets (id, name, public)
values ('mail-attachments', 'mail-attachments', false)
on conflict (id) do nothing;

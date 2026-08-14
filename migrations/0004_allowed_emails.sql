-- Cockpit-toegang: wie mag inloggen + met welke rol. De cockpit gebruikt
-- Supabase Auth (e-mail + wachtwoord); ná een geslaagde login bepaalt deze
-- tabel of het adres toegang heeft en welke rol het krijgt.
--
-- Alleen via service-role benaderd (de cockpit-Worker), dus RLS aan zonder
-- policies — net als de overige aios_* tabellen.

create table if not exists public.allowed_emails (
  email      text primary key,
  role       text not null default 'reviewer'
             check (role in ('admin', 'reviewer', 'viewer')),
  created_at timestamptz not null default now()
);

alter table public.allowed_emails enable row level security;

-- Eerste beheerder: vul het adres in en draai deze regel één keer, anders kan
-- er na de setup niemand inloggen (de cockpit is fail-closed). Daarna nodigt
-- die beheerder de rest uit via de Toegang-pagina.
--
-- insert into public.allowed_emails (email, role)
-- values ('<beheerder@klant.nl>', 'admin')
-- on conflict (email) do nothing;

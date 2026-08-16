-- 0031_role_grants
-- Rechten per rol: in welke module, met welke datacategorieën.
--
-- Eén rechtenmodel, geen tweede ernaast. De rol hier is dezelfde rol als in
-- `allowed_emails` (admin | reviewer | viewer) — die bepaalt wat iemand mag
-- goedkeuren én, met deze tabel, wat hij mag zien.
--
-- Twee assen omdat één niet genoeg is:
--   module    — een salesmedewerker hoort geen administratie-item goed te
--               keuren, ook niet als hij reviewer is.
--   categorie — binnen een proces bepaalt de categorie hoe diep je kijkt.
--               Een medewerker ziet de orderstatus, niet de marge.
--
-- Contract: `RoleGrant` + `resolveAccess` in @factumai/agent-core/access.
-- Categorieën: operationeel | commercieel | financieel, gelijk aan
-- `DataCategory` in de MCP-laag (@factumai/shared) die er velden mee afsluit.

create table if not exists public.aios_role_grants (
  organization_id text not null,
  role            text not null
                  check (role in ('admin', 'reviewer', 'viewer')),
  -- Module-id, of '*' voor elke geregistreerde module. Een rij op de module
  -- zelf wint van de joker, zodat "iedereen operationeel, behalve in
  -- administratie" uitdrukbaar is zonder elke module op te sommen.
  module          text not null,
  categories      text[] not null default '{}',
  updated_at      timestamptz not null default now(),
  primary key (organization_id, role, module),
  -- Fail-closed op onzin: een categorie die niemand kent, hoort niet stil te
  -- worden genegeerd bij het schrijven.
  constraint aios_role_grants_categories_known check (
    categories <@ array['operationeel', 'commercieel', 'financieel']::text[]
  )
);

alter table public.aios_role_grants enable row level security;

comment on table public.aios_role_grants is
  'Wat een rol per module mag zien. Leeg voor een tenant = het standaardvoorstel uit agent-core (DEFAULT_ROLE_GRANTS).';
comment on column public.aios_role_grants.module is
  'Module-id (klantenservice | sales | administratie | operations, open lijst) of ''*'' voor alle modules. Specifieke rij wint van de joker.';
comment on column public.aios_role_grants.categories is
  'Datacategorieën die deze rol in deze module mag zien. Leeg = geen enkele; de rol mag de module wel betreden maar ziet geen geclassificeerd veld.';

-- Standaardvoorstel uit de bouwbriefing, vertaald naar de bestaande rollen.
-- Alleen invoegen waar nog niets staat: een tenant die zijn rechten al heeft
-- ingericht, mag deze migratie opnieuw draaien zonder overschreven te worden.
--
-- Bewust conservatief aan de onderkant: reviewer is de dagelijkse medewerker en
-- krijgt alleen operationeel. Wil een klant dat teamleiders orderbedragen zien,
-- dan is dat een rij erbij en geen codewijziging.
insert into public.aios_role_grants (organization_id, role, module, categories)
select org.id, g.role, '*', g.categories
from (select distinct organization_id as id from public.aios_review_items) org
cross join (values
  ('viewer',   array['operationeel']),
  ('reviewer', array['operationeel']),
  ('admin',    array['operationeel', 'commercieel', 'financieel'])
) as g(role, categories)
on conflict (organization_id, role, module) do nothing;

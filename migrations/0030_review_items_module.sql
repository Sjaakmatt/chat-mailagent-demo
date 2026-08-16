-- 0030_review_items_module
-- De werkbak draagt meer dan één automatisering: elk voorstel weet uit welk
-- proces het komt.
--
-- Waarom naast `kind` en niet erin: `kind` is de VORM van een voorstel
-- (draft_email, invoice), `module` is het PROCES dat het produceerde. Een
-- factuur kan uit administratie komen of uit sales. Zonder dat onderscheid kun
-- je de werkbak niet per proces tabben en kun je niet zeggen wie 'm mag
-- goedkeuren.
--
-- Contract: `ModuleId` + `ReviewItem.module` in @factumai/agent-core/contracts.
--
-- Nummering: dit bestand springt naar 0030 en niet naar 0023. De klant-repo
-- chat-mailagent-demo gebruikt 0023 t/m 0027 al voor eigen migraties; twee
-- bestanden met hetzelfde nummer geeft een dubbelzinnige volgorde zodra die
-- repo `upstream/main` mergt. De ruimte 0023-0029 blijft vrij voor die klant.

alter table public.aios_review_items
  add column if not exists module text;

-- Backfill: alles van vóór de moduleopdeling komt uit de mailagent, en dat is
-- de klantenservice-module. Alleen rijen zonder waarde, zodat deze migratie
-- opnieuw mag draaien zonder een latere handmatige correctie terug te draaien.
update public.aios_review_items
  set module = 'klantenservice'
  where module is null;

-- Pas ná de backfill afdwingen; anders faalt de alter op bestaande rijen.
-- De default dekt schrijvers die de kolom (nog) niet kennen — nieuwe schrijvers
-- zetten 'm expliciet.
alter table public.aios_review_items
  alter column module set default 'klantenservice';

alter table public.aios_review_items
  alter column module set not null;

-- De werkbak filtert per tab op openstaand werk binnen één module.
create index if not exists aios_review_items_module_status_idx
  on public.aios_review_items (organization_id, module, status, created_at desc);

comment on column public.aios_review_items.module is
  'Het proces dat dit voorstel produceerde: klantenservice | sales | administratie | operations (open lijst). Bepaalt de tab in de werkbak en wie het item mag goedkeuren.';

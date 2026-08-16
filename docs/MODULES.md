# Modules — meerdere automatiseringen in één werkbak

De werkbak is het fundament. Klantenservice, sales, administratie en operations
zijn **modules** die erin dokken: elk met een eigen tab, eigen categorieën, eigen
schermen, en straks een eigen stuk van de assistent.

Vandaag is klantenservice de enige geregistreerde module. Dit document beschrijft
het contract waarlangs de tweede erbij komt.

## De verdeling in één zin

`kind` is de **vorm** van een voorstel (`draft_email`, `invoice`). `module` is
het **proces** dat het produceerde. Een factuur kan uit administratie komen of
uit sales; zonder dat onderscheid kun je de werkbak niet per proces tabben en
kun je niet zeggen wie hem mag goedkeuren.

## Twee helften

| Helft | Waar | Wat |
| --- | --- | --- |
| Data | `packages/agent-core/src/modules/` | `ModuleId`, `ReviewItem.module`, `ModuleDescriptor` — wat een module over zichzelf verklaart |
| Schil | `ui/lib/modules/` | `WorkbenchModule` — tab, kaart-viewmodel, detail-link, auditbron, assistent-scope |

Bewust gescheiden: de agent-Worker heeft geen React nodig, en de cockpit heeft
geen lus-kennis nodig.

## Wat een module NIET levert

**Geen React-componenten.** Een module levert een `ReviewCardViewModel` — titel,
ondertitel, badges, link — en de schil tekent de kaart. Zou een module een eigen
kaartcomponent meebrengen, dan importeert de schil module-code en is de werkbak
nooit los te trekken van zijn modules. Nu is de afhankelijkheid één kant op.

## Een module toevoegen

### 1. Descriptor in de agent-laag

```ts
// packages/agent-core/src/modules/sales.ts
export const SALES_MODULE: ModuleDescriptor = {
  id: 'sales',
  label: 'Sales',
  description: 'Offerte-aanvragen en opvolging.',
  kinds: ['quote', 'task'],
  categories: [{ slug: 'offerte_aanvraag', label: 'Offerte-aanvraag' }],
};
```

Categorieën staan **per module** en niet in één gedeelde taxonomie: sales
classificeert niet in klantenservice-categorieën, en dezelfde slug kan in een
ander proces iets anders betekenen.

### 2. Registratie in de cockpit

```ts
// ui/lib/modules/sales.ts
export const salesModule: WorkbenchModule = {
  id: SALES_MODULE.id,
  label: SALES_MODULE.label,
  description: SALES_MODULE.description,
  icon: TrendingUp,
  order: 20,                                  // tabvolgorde; laag = links
  kinds: SALES_MODULE.kinds,
  categories: SALES_MODULE.categories,
  detailHref: (id) => `/offerte/${encodeURIComponent(id)}`,
  toCard(row) { /* jouw velden → titel/ondertitel/badges */ },
};
```

### 3. Eén regel in het register

```ts
// ui/lib/modules/registry.ts
export const MODULES = Object.freeze([klantenserviceModule, salesModule].sort(…));
```

`registry.ts` is het **enige** bestand in de cockpit dat een module bij naam
kent. De werkbak, de kaart, de beleidseditor en de auditlog praten met de
registry. Dat is de eigenschap die telt: verhuist de werkbak later naar een
eigen repo, dan gaan de moduleregistraties mee met hun automatisering en blijft
dit bestand als lijst achter.

### 4. De agent schrijft `module` mee

```ts
module: item.module ?? SALES_MODULE.id,
```

Zie `agents/mail-agent/src/store.ts`. Historie zonder de kolom valt terug op
`kind`; nieuwe schrijvers vullen het veld altijd.

## Wat de schil ermee doet

- **Tabs** — `ui/app/(dashboard)/page.tsx` bouwt de tabbalk uit `MODULES`. Bij
  één module tekent hij hem niet: tabs die niets te kiezen geven zijn ruis. De
  tellers lopen over álle modules, ook als er één actief is, anders zie je niet
  dat er ergens anders werk ligt.
- **Kaarten** — `ReviewCard` rendert het viewmodel van de module. Triage en
  zekerheid zijn van de schil, de badges van de module.
- **Beleid** — de categorielijst komt uit `allCategories()`. Bij meer dan één
  module staat het proces erbij, want "facturatie" betekent iets anders in
  administratie dan in klantenservice.
- **Weesitems** — een voorstel waarvan geen enkele geregistreerde module de
  `module` of `kind` claimt, wordt geteld en gemeld, niet getoond. Het komt uit
  een automatisering die hier niet (meer) draait; stilzwijgend in de eerste tab
  gooien maakt het werk van iemand anders onzichtbaar.

## De assistent

`WorkbenchModule.assistant` legt vast welke MCP's en welke beslislog-bronnen bij
dit proces horen. Nog niet in gebruik — de assistent komt in stap 3 van de
bouwbriefing — maar de plek ligt er al, omdat de assistent een **schil**-functie
is die over de tabs heen kijkt. Zonder deze plek zou de scope-vraag later alsnog
module-kennis in de schil worden.

De rechten liggen er wél al: rol → (module, categorie), in `aios_role_grants`.
Een salesmedewerker keurt geen administratie-item goed, ook niet als hij
`reviewer` is. Zie [`docs/RECHTEN.md`](./RECHTEN.md).

## Wat er nog niet af is

De **detailschermen** van klantenservice staan nog in de schil-mappen:
`ui/app/(dashboard)/mail/[id]/`, `ui/app/api/review/[id]/` en
`ui/components/mail-detail/`. Ze zijn wel ontkoppeld — ze lezen `proposed` via
`mailProposed()` uit de module in plaats van via een gedeeld mailtype — maar ze
liggen nog niet bij elkaar. Dat verhuizen is de logische volgende stap zodra de
tweede module er is en de vorm zich bewezen heeft.

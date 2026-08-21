# Modules — meerdere automatiseringen in één werkbak

De werkbak is het fundament. Klantenservice, sales, administratie en operations
zijn **modules** die erin dokken: elk met een eigen poort, eigen categorieën,
eigen specialisten, eigen schermen.

Vandaag is klantenservice de enige geregistreerde module. Dit document beschrijft
het contract waarlangs de tweede erbij komt.

## Een module is geen tab, een module is een pakket

Dat is de hele gedachte. Alles wat een domein tot een domein maakt — waar het
wel en niet over gaat, waarin het classificeert, wie de tekst schrijft, wat het
in een bronsysteem mag schrijven, wanneer iets automatisch mag — zit in één
object dat de kern uitleest.

Vóór deze opzet stond dat allemaal globaal: één `CATEGORIES`, één `DOMAIN`, één
`CORE_INTENTS`, één `ACTION_TYPES`. Allemaal over een webshop. Zet je
administratie ernaast, dan wijst de poort een crediteurenvraag af als buiten
scope, kiest de router een klantenservice-specialist, en matcht het beleid op
een categorie die in dat proces iets anders betekent. Er was geen plek waar
stond: *dit signaal hoort bij deze module, gebruik háár gate en taxonomie.*

## De verdeling in één zin

`kind` is de **vorm** van een voorstel (`draft_email`, `invoice`). `module` is
het **proces** dat het produceerde. Een factuur kan uit administratie komen of
uit sales; zonder dat onderscheid kun je de werkbak niet per proces tabben en
kun je niet zeggen wie hem mag goedkeuren.

## Twee helften

| Helft | Waar | Wat |
| --- | --- | --- |
| Lus | `packages/agent-core/src/modules/` | `ModulePack` — poort, taxonomie, specialisten, acties, uitkomsten |
| Schil | `ui/lib/modules/` | `WorkbenchModule` — tab, kaart-viewmodel, detail-link, auditbron, assistent-scope |

Bewust gescheiden: de agent-Worker heeft geen React nodig, en de cockpit heeft
geen lus-kennis nodig. De brug ertussen is de `ModuleDescriptor` — id, label,
`kinds`, `categories` — die beide helften delen.

## Het pakket

```ts
// packages/agent-core/src/modules/contract.ts
export interface ModulePack {
  descriptor: ModuleDescriptor;      // id, label, kinds, categories
  claims: readonly SignalClaim[];    // welke signalen deze module claimt
  gate: DomainConfig;                // waar dit domein wel en niet over gaat
  taxonomy: readonly CategoryDef[];  // slug, label, specialist, afbakening
  specialists: readonly IntentConfig[];
  facts: readonly FactProvider[];    // feitenbronnen (fase 3 vult dit)
  actions: readonly ActionTypeDef[]; // schrijfoperaties van dit domein
  outcomes: OutcomePolicy;           // identificatie per kanaal + terugval-uitkomst
  review: ReviewPolicy;              // welke vorm een voorstel krijgt
  memory: MemoryPolicy;              // welke procestags dit domein gebruikt
  models?: Partial<ModelConfig>;     // optionele modeloverride per tier
}
```

De drie beleidsobjecten zijn bewust minimaal: er staat alleen in wat de kern
écht uitleest. `ReviewPolicy` heeft alleen `defaultKind` — de `kinds` staan al
op de descriptor, en twee lijsten die uit elkaar kunnen lopen zijn erger dan
één lijst op een iets andere plek.

### Routering

```
Signal binnen
   │
   ▼  resolveModule(signal)        ← matcht op claims: domain + type (+ predicaat)
ModulePack
   │
   ▼  pack.gate         → hoort dit hier thuis?
   ▼  pack.taxonomy     → welke categorie
   ▼  pack.specialists  → welke specialist
   ▼  pack.actions      → welke schrijfoperaties mag hij voorstellen
   ▼  pack.outcomes     → mag dit zonder mens
   ▼  pack.review       → welke vorm
   │
   ▼
ReviewItem(module = pack.descriptor.id, PENDING)
```

Eén signaal, één module. Geen enkele module kent een andere, en de kern kent er
geen bij naam: `resolveModule` staat aan de rand (`agents/mail-agent/src/modules.ts`)
en het pakket gaat als input de lus in.

**Geen match is een expliciet resultaat.** `resolveModule` geeft dan `null` en
het signaal blijft staan met een leesbare reden. Geen terugval op
klantenservice: een bankmutatie door de poort van de klantenservice sturen
levert een keurig geformuleerd "daar ga ik niet over" op iets waar wél iemand
naar had moeten kijken.

Claimen twee modules hetzelfde signaal, dan wint de eerste in manifest-volgorde.
Zet de specifiekste module bovenaan, of scherp de claim aan met een predicaat.

### Mappenstructuur

```
packages/agent-core/src/modules/
  contract.ts             ModulePack, SignalClaim, FactProvider, de drie policies
  registry.ts             resolveModule(), packById(), actionTypeBySlug(), assertRegistry()
  registry.generated.ts   ← gegenereerd uit client.manifest.yaml
  klantenservice/
    pack.ts  descriptor.ts  gate.ts  taxonomy.ts  actions.ts  outcomes.ts
    specialists/{simple-reply,order-change,complaint,technical,gdpr,escalate}.ts
```

De mappen `taxonomy/`, `domain-gate/`, `outcomes/`, `specialists/` en `actions/`
bestaan nog, maar bevatten alleen nog het **contract en de generieke helpers**.
De helpers nemen de lijst als parameter: `categoryToSpecialist(taxonomy, slug)`,
`getIntentConfig(specialists, id)`, `isIdentified(policies, channel, input)`.

## Het register wordt gegenereerd

`ui/lib/modules/registry.ts` en de domein-registratie in de agent waren de twee
bestanden die élke klant aanpaste, en dus de twee bestanden waarop élke
fundament-update semantisch botst — zonder dat git een conflict meldt, want de
regels eromheen zijn gelijk gebleven. Met tien klantrepo's is dat een tijdbom.

Daarom komt de lijst uit het `modules:`-blok van `client.manifest.yaml`:

```yaml
modules:
  - id: "klantenservice"
    source: "core"     # of "client" voor een module van deze klant
    order: 10          # tabvolgorde; laag = links
```

```bash
pnpm modules:generate          # schrijft beide registers
pnpm modules:generate --check  # faalt als ze achterlopen (draait in CI)
```

Dat schrijft `packages/agent-core/src/modules/registry.generated.ts` en
`ui/lib/modules/registry.generated.ts`. **Een merge-conflict in een register los
je op door het script opnieuw te draaien**, niet met de hand.

## Een module toevoegen

### 1. Het pakket in de lus

```
packages/agent-core/src/modules/sales/          (fundament)
packages/agent-core/src/client-modules/sales/   (alleen deze klant)
```

Één map met `pack.ts` (geëxporteerd als `salesPack`), `descriptor.ts`, en de
onderdelen ernaast. Kopieer `klantenservice/` als vertrekpunt; het is de
startset waar elke klant van vertrekt.

Categorieën staan **per module** en niet in één gedeelde taxonomie: sales
classificeert niet in klantenservice-categorieën, en dezelfde slug kan in een
ander proces iets anders betekenen. Beleidsregels matchen daarom op
`module:slug` — zie `categoryKey` in agent-core.

**Actie-slugs zijn uniek over álle modules heen.** `aios_proposed_actions.type`
draagt alleen de slug, dus twee modules met dezelfde slug zijn bij het
goedkeuren niet uit elkaar te houden. `assertRegistry()` weigert dat luid; wil
je dezelfde operatie in twee processen, geef ze een eigen slug.

### 2. De registratie in de cockpit

```ts
// ui/lib/modules/sales.ts        (of ui/lib/client-modules/sales.ts)
export const salesModule: WorkbenchModule = {
  id: SALES_MODULE.id,
  label: SALES_MODULE.label,
  description: SALES_MODULE.description,
  icon: TrendingUp,
  kinds: SALES_MODULE.kinds,
  categories: SALES_MODULE.categories,
  detailHref: (id) => `/offerte/${encodeURIComponent(id)}`,
  toCard(row) { /* jouw velden → titel/ondertitel/badges */ },
};
```

De tabvolgorde staat in het manifest, niet op de module: één plek waar de
volgorde van álle modules te zien is.

### 2b. Eigen schermen — en ze ook echt dichtzetten

Heeft de module schermen naast de werkbak-tab, zet ze dan op de module en niet
in `lib/brand.ts`:

```ts
  navItems: [
    { href: "/tickets", label: "Tickets", icon: ClipboardList },
  ],
```

De zijbalk toont ze dan alleen aan wie deze afdeling heeft. **Dat is cosmetica.**
Verbergen is geen weigeren: zonder guard is het scherm gewoon bereikbaar door de
URL in te tikken. Zet daarom op elke pagina:

```ts
const user = await requireModulePage(SALES_MODULE.id);
```

en op elke route-handler erachter `requireModule(SALES_MODULE.id, "reviewer")`
in plaats van `requireRole("reviewer")` — anders mag een reviewer uit een andere
afdeling wél schrijven: genoeg rang, verkeerd proces.
`scripts/check-module-guards.mjs` leidt die routes af uit het gegenereerde
register en faalt als de guard ontbreekt.

De layout rekent de toegestane items uit en geeft ze aan de zijbalk door. Dat
gebeurt dáár en niet in de zijbalk zelf, omdat die een client-component is: zou
hij de moduleregistry importeren, dan trekt `collectSources` de database-laag
mee de browserbundel in. Het icoon gaat als gerenderd element over de
RSC-grens — een componentfunctie overleeft die niet.

### 3. Eén regel in het manifest

```yaml
modules:
  - id: "klantenservice"
    source: "core"
    order: 10
  - id: "sales"
    source: "client"
    order: 20
```

Daarna `pnpm modules:generate` en de twee registers committen. Verder is er
niets: er is geen plek waar je de module nog moet aanmelden.

### 4. Een migratie voor je eigen tabellen

Heeft de module eigen tabellen met werk of kennis van dit proces, geef ze dan
dezelfde `module`-kolom en index als de kern-tabellen (zie migratie 0035).
Zonder die kolom valt zo'n tabel buiten elke modulezeef, en dan lekt hij over de
afdelingen heen.

## Wat een module NIET levert

**Geen React-componenten.** Een module levert een `ReviewCardViewModel` — titel,
ondertitel, badges, link — en de schil tekent de kaart. Zou een module een eigen
kaartcomponent meebrengen, dan importeert de schil module-code en is de werkbak
nooit los te trekken van zijn modules. Nu is de afhankelijkheid één kant op.

## Wat de schil ermee doet

- **Tabs** — `ui/app/(dashboard)/page.tsx` bouwt de tabbalk uit `MODULES`. Bij
  één module tekent hij hem niet: tabs die niets te kiezen geven zijn ruis. De
  tellers lopen over álle modules, ook als er één actief is, anders zie je niet
  dat er ergens anders werk ligt.
- **Kaarten** — `ReviewCard` rendert het viewmodel van de module. Triage en
  zekerheid zijn van de schil, de badges van de module.
- **Beleid** — de categorielijst komt uit `allCategories()`, gesleuteld op
  `{module, slug}`. Bij meer dan één module staat het proces erbij, want
  "facturatie" betekent iets anders in administratie dan in klantenservice.
- **Cijfers en auditlog** — beide filteren op de modules waar de gebruiker in
  mag, en de bron-link loopt via `detailHref` van de module.
- **Weesitems** — een voorstel waarvan geen enkele geregistreerde module de
  `module` of `kind` claimt, wordt geteld en gemeld, niet getoond. Het komt uit
  een automatisering die hier niet (meer) draait; stilzwijgend in de eerste tab
  gooien maakt het werk van iemand anders onzichtbaar.

## De assistent

`WorkbenchModule.assistant` legt vast welke MCP's en welke beslislog-bronnen bij
dit proces horen, en `collectSources` levert de bronnen die de assistent bij een
item van deze module mag lezen. Zie [`docs/ASSISTENT.md`](./ASSISTENT.md).

De rechten liggen in `aios_role_grants`: rol → (module, categorie). Een
salesmedewerker keurt geen administratie-item goed, ook niet als hij `reviewer`
is. Zie [`docs/RECHTEN.md`](./RECHTEN.md).

## Wat er nog niet af is

De **detailschermen** van klantenservice staan nog in de schil-mappen:
`ui/app/(dashboard)/mail/[id]/`, `ui/app/api/review/[id]/` en
`ui/components/mail-detail/`. Ze zijn wel ontkoppeld — ze lezen `proposed` via
`mailProposed()` uit de module in plaats van via een gedeeld mailtype — maar ze
liggen nog niet bij elkaar, en `api/review/[id]` behandelt elk item nog als een
mail. Dat verhuizen is fase 4.

De **feitenlaag** (`pack.facts`) staat in het contract maar is nog leeg: de
feiten komen vandaag uit vaste lookups in de agent-Worker. Dat is fase 3, en
dan wordt `toolScope` op de specialisten ook echt gehandhaafd.

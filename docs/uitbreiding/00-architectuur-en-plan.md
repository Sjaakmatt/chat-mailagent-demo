# Van mailagent naar bedrijfsbreed fundament

**Plan en bouwopdracht voor `mail-agent-fundament`**
Versie: augustus 2026. Auteur: sparringsessie Sjaak ter Veld / Claude.
Status: bouwplan. Alle code wordt in Claude Code gemaakt, niet hier.

---

## 0. Waar dit over gaat

Je hebt een werkend fundament dat één ding goed doet: klantmail classificeren,
verrijken met feiten en een concept-antwoord voorstellen dat een mens goedkeurt.
Je wilt daarvan een systeem maken dat de hele bedrijfsvoering kan dragen:
klantenservice, administratie, supply chain, sales, marketing, HR en wat er nog
bij komt. Per klant klonen, per klant aanzetten wat ze afnemen, en uitbreiden
zodra een klantverzoek eruitziet als iets dat vaker terugkomt.

Dat is de juiste ambitie en het fundament staat er dichter bij dan het lijkt.
Maar er zit een verschil tussen "de werkbak kan meer modules tonen" en "een
tweede domein werkt echt". Het eerste is af. Het tweede vraagt vier ingrepen in
de kern. Dit document beschrijft welke, waarom, in welke volgorde, en met welke
acceptatiecriteria.

---

## 1. Wat er nu staat

Kort, want je kent het. Wat telt is welk deel al generiek is.

**Al generiek en met rust te laten:**

| Onderdeel | Waar | Waarom het klopt |
| --- | --- | --- |
| `Signal` en `ReviewItem` | `contracts/index.ts` | Vendorloos. `kind` en `ModuleId` zijn open unions |
| Work-bus | `signals/`, `poller/`, migratie `0002` | pgmq, transactional outbox, at-least-once. Geen mailkennis |
| Grounding | `grounding/index.ts` | Tekst-agnostisch, werkt op claims en tool-call-ids |
| Beslislog | `decision-log/` | Eén rij per run met poort, uitkomst en bronnen |
| Actie-poort | `actions/index.ts` + `actions/execute.ts` | Registry met precondities, bewijs, bedragdrempels, goedkeurdersrol. Dit is het beste stuk van de repo |
| Execute-lus | `execute/index.ts` | Werkt puur op een `ReviewItem` met geïnjecteerde `performAction` |
| Rechtenmodel | `access/entitlement.ts`, `grants.ts` | Afname ∩ gebruiker ∩ rol. Precies het model dat je nodig hebt voor upsell |
| Werkbak-schil | `ui/app/(dashboard)/page.tsx`, `ReviewCard`, `ModuleTabs` | Tabt al over modules, telt weesitems, filtert op rechten |
| Per-klant scaffolding | `scripts/new-client.sh`, `upstream-sync.yml`, `notify-clients.yml` | Klonen en terugsyncen werkt |

Dat is een serieuze basis. De entitlement-laag alleen al is het verschil tussen
"we bouwen per klant iets" en "we verkopen modules".

---

## 2. De vijf breuklijnen

Dit is wat een tweede domein vandaag onmogelijk maakt zonder de kern te forken.

### 2.1 Domeinkennis staat globaal, niet per module

`taxonomy/index.ts` bevat elf categorieën. Ze gaan over een webshop.
`domain-gate/index.ts` bevat één `DOMAIN`-constante met inScope, outOfScope en
één `rejectionText`. Die gaat over een webshop. `outcomes/index.ts` mapt zes
kern-specialisten hard naar uitkomsten. Die zes gaan over een webshop.
`specialists/index.ts` heeft één bevroren `CORE_INTENTS`-array.

Zet je administratie ernaast, dan classificeert de gate een crediteurenvraag als
buiten scope, kiest de router een klantenservice-specialist, en matcht het beleid
op een categorie die iets anders betekent. Er is geen plek waar staat: *dit
signaal hoort bij deze module, gebruik de gate, taxonomie en specialisten van
die module.*

### 2.2 De `ModuleDescriptor` is leeg

Vandaag: `id`, `label`, `description`, `kinds`, `categories`. Meer niet. En de
agent-lus leest hem nergens. Alleen de cockpit gebruikt hem.

Alles wat een module tot een module maakt (gate, specialisten, feitenbronnen,
actietypen, uitkomstbeleid, geheugentags, modelkeuze) leeft buiten de descriptor
in globale singletons. Het contract dat `docs/MODULES.md` belooft, bestaat aan de
UI-kant wel en aan de agent-kant niet.

### 2.3 Alles begint met een mail

`channels/index.ts` kent twee kanalen: mail en chat. De Worker heeft geen
webhook-route (`index.ts` antwoordt letterlijk "Inbound events horen op de
MCP-laag"). De cron doet alleen `kickPoller`, hij maakt geen signalen aan. De
tabel `aios_automations` bestaat met `trigger`, `schedule` en `tool_scope`, en
wordt door geen enkele regel code gelezen.

Dit is de grootste blokkade. Administratie begint bij een openstaande post die
te lang openstaat. Supply chain begint bij een voorraadstand of een
vervoerderstatus. Sales begint bij een offerte zonder reactie. Geen van die
drie begint bij een mail. Zonder triggerlaag zijn de andere domeinen alleen
te bouwen als "iemand mailt erover", en dat is precies het slappe deel van de
markt.

Daarbovenop leest de kern rechtstreeks mailvelden: `payload.from` in
`orchestrate/index.ts` op twee plekken, `payload.attachments`, `subject` en
`bodyText` in `steps.ts`, en `kind: 'draft_email'` als default op vier plekken.

### 2.4 Feiten komen uit hardgecodeerde demo-lookups

`IntentConfig.toolScope` is netjes gedeclareerd op elke specialist, en wordt
**nergens uitgelezen**. De feiten die de planner krijgt komen uit drie vaste
functies in `steps.ts` die tegen de demo-tabellen praten
(`lookupCatalogFromDb`, `lookupOrderFromDb`, `lookupInvoiceFromDb`).

Gevolg: grounding werkt vandaag alleen voor demo-orders. Een tweede domein heeft
geen manier om feiten binnen te halen zonder `steps.ts` te bewerken, en
`steps.ts` is een kernbestand dat bij elke klant meemerged. Dat is precies de
plek waar je geen maatwerk wilt.

Bijkomend: `dataCategories` staat wel op de `TenantContext` maar wordt in
`resolve` niet gezet. De belofte uit `docs/RECHTEN.md` dat een MCP terugsnijdt op
wat de aanroeper mag zien, wordt in de agent-lus dus niet waargemaakt.

### 2.5 De schil lekt tussen modules

Concreet, en dit zijn echte bugs zodra module twee bestaat:

| Plek | Wat er misgaat |
| --- | --- |
| `ui/app/(dashboard)/analytics/page.tsx` | Geen `getCurrentAccess()`, geen modulefilter. Iedereen ziet de cijfers van alle modules |
| `ui/app/(dashboard)/audit/page.tsx` + `api/audit/export` | Kern-events zonder modulefilter, "bekijk bron" linkt altijd naar `/mail/{id}` |
| `ui/app/api/review/[id]/route.ts` | Behandelt elk item als mail: leest `subject`/`body` via `mailProposed` |
| `allCategories()` in `registry.ts` | Ontdubbelt op slug. Deelt administratie de slug `factuur` met klantenservice, dan verdwijnt de tweede stil uit de beleidseditor |
| `aios_policy_rules` | Geen modulekolom. Beleid matcht op categorie-slug die per module iets anders betekent |
| `aios_tickets`, `aios_conversations`, `aios_proposed_actions`, `aios_decision_logs`, `aios_message_feedback`, `aios_memory_entries` | Geen modulekolom, geen module-index |
| `aios_ticket_counters` | Nummerreeks per organisatie, niet per module |
| `AssistantDock` | Krijgt één vaste `moduleId`, kan niet wisselen |

---

## 3. Het doelmodel: het modulepakket

Eén idee draagt de hele verbouwing. **Een module is geen tab, een module is een
pakket.** Alles wat een domein tot een domein maakt, verhuist naar één object
dat de kern uitleest.

```ts
// packages/agent-core/src/modules/contract.ts
export interface ModulePack {
  descriptor: ModuleDescriptor;          // id, label, kinds, categories

  /** Welke signalen deze module claimt. Bepaalt de routering. */
  claims: SignalClaim[];                 // { domain, type } of predicaat

  /** Waar deze module wel en niet over gaat. Per module een eigen gate. */
  gate: DomainConfig;

  /** slug, label, specialist, hint. Voedt de classify-prompt van deze module. */
  taxonomy: readonly CategoryDef[];

  /** De specialisten van dit domein. Geen globale CORE_INTENTS meer. */
  specialists: readonly IntentConfig[];

  /** Feitenbronnen: toolnaam -> MCP + tool + dataCategories. */
  facts: readonly FactProvider[];

  /** Schrijfoperaties van dit domein, in ACTION_TYPES-vorm. */
  actions: readonly ActionTypeDef[];

  /** Identificatie-eisen en uitkomstroutering van dit domein. */
  outcomes: OutcomePolicy;

  /** Welke kinds, welke default, en hoe het detailscherm rendert. */
  review: ReviewPolicy;

  /** Welke memory-scopes en procestags dit domein gebruikt. */
  memory: MemoryPolicy;

  /** Optionele modeloverride per tier. */
  models?: Partial<ModelConfig>;
}
```

En de UI-helft blijft waar hij is (`ui/lib/modules/`), want de agent-Worker heeft
geen React nodig. Dat was een goede beslissing, die houden we.

### 3.1 Routering

```
Signal binnen
   │
   ▼  resolveModule(signal)        ← nieuw: claims matchen op domain + type
ModulePack
   │
   ▼  pack.gate         → hoort dit hier thuis?
   ▼  pack.taxonomy     → welke categorie
   ▼  pack.specialists  → welke specialist
   ▼  pack.facts        → welke feiten mag deze specialist ophalen
   ▼  pack.actions      → welke schrijfoperaties mag hij voorstellen
   ▼  pack.review       → welke kind, welk detailscherm
   │
   ▼
ReviewItem(module = pack.id, PENDING)
```

Eén signaal, één module. Geen enkele module kent een andere. De kern kent geen
enkele module bij naam, alleen de registry doet dat.

### 3.2 Mappenstructuur

```
packages/agent-core/src/modules/
  contract.ts                  ModulePack, FactProvider, OutcomePolicy, ReviewPolicy
  registry.ts                  MODULE_PACKS + resolveModule() + lookups
  klantenservice/
    pack.ts  gate.ts  taxonomy.ts  facts.ts  actions.ts  outcomes.ts
    specialists/{simple-reply,order-change,complaint,gdpr,technical,escalate}.ts
  administratie/
    pack.ts  gate.ts  taxonomy.ts  facts.ts  actions.ts  outcomes.ts
    specialists/*.ts
  supplychain/ ...
  sales/ ...
  marketing/ ...
  hr/ ...
```

De bestaande mappen `taxonomy/`, `domain-gate/`, `specialists/` en `outcomes/`
blijven bestaan als **contract en hulpfuncties**, en verliezen hun
klantenservice-inhoud. Die inhoud verhuist naar `modules/klantenservice/`.

### 3.3 Waarom dit ook de upstream-flow redt

Vandaag zijn `ui/lib/modules/registry.ts` en
`agents/mail-agent/src/domain/index.ts` de bestanden die elke klant aanpast. Dat
zijn dus de bestanden waarop elke fundament-update semantisch botst, zonder dat
git een conflict meldt. Met tien klantrepo's is dat een tijdbom.

Oplossing: **de registry wordt gegenereerd**. `client.manifest.yaml` krijgt een
`modules:`-blok, en een codegen-script schrijft daaruit `registry.generated.ts`
in beide helften. Een merge-conflict los je dan op door het script opnieuw te
draaien, niet met de hand. Klantspecifieke modules komen in
`packages/agent-core/src/client-modules/` en `ui/lib/client-modules/`, mappen die
het fundament nooit aanraakt.

---

## 4. De triggerlaag

Dit is de tweede kernwijziging en de enige die echt nieuw is.

### 4.1 Vijf bronsoorten

| Bron | Hoe | Voorbeeld |
| --- | --- | --- |
| `inbound` | MCP duwt via `aios_emit_signal` (bestaat) | mail binnen, chatbericht |
| `webhook` | Nieuwe route `POST /hooks/:source` op de agent-Worker, HMAC-verificatie, dan `aios_emit_signal` | nieuwe order in WooCommerce, sollicitatie in Recruitee, review binnen |
| `schedule` | Cron leest `aios_automations`, emit `schedule.<naam>` | dagelijks openstaande posten, wekelijks offertes zonder reactie |
| `poll` | Periodieke MCP-query, diff tegen een cursor, emit per nieuwe rij | nieuwe inkoopfacturen in Exact, statuswijziging bij de vervoerder |
| `upload` | Supabase Storage-event, dan extractiestap | inkoopfactuur als PDF, bonnetje, contract |

De tabel `aios_automations` bestaat al met de juiste kolommen. Hij wordt alleen
nooit gelezen. Dat is een half uur werk om aan te zetten, en het opent drie
domeinen.

### 4.2 Poll heeft een cursor nodig

Nieuwe tabel:

```sql
create table aios_poll_cursors (
  organization_id text not null,
  module          text not null,
  source          text not null,      -- 'erp.invoices'
  cursor          text,               -- laatste id of timestamp
  last_run_at     timestamptz,
  last_error      text,
  primary key (organization_id, module, source)
);
```

Zonder cursor krijg je bij elke poll dezelfde rijen opnieuw. De
idempotency-sleutel op `aios_signals` vangt dat af, maar dan doe je wel elke keer
de MCP-call. Cursor is goedkoper.

### 4.3 De hydrator-registry en het envelop-model

`steps.ts:736` doet vandaag `if (signal.domain !== 'mail' || !messageId) return signal`.
Dat wordt een registry:

```ts
type Hydrator = (signal: Signal, ctx: RunContext) => Promise<SignalEnvelope>;
const HYDRATORS: Record<string, Hydrator>;   // per domain
```

En de kern leest niet langer `payload.from`, maar een genormaliseerde envelop:

```ts
interface SignalEnvelope {
  subject: string | null;
  body: string;                       // platte tekst waarop geclassificeerd wordt
  participants: Participant[];        // { role: 'from'|'to'|'subject', ref, kind }
  refs: Record<string, string|null>;  // orderId, invoiceId, candidateId, ...
  attachments: Attachment[];
  occurredAt: string;
  raw: Record<string, unknown>;       // het originele payload, voor het detailscherm
}
```

Daarna zijn `orchestrate/index.ts:566`, `:615` en `:632` één regel elk in plaats
van mailkennis in de kern. Dit is de goedkoopste ingreep met het grootste effect.

---

## 5. De feitenlaag

De hardgecodeerde lookups in `steps.ts` verdwijnen. In plaats daarvan declareert
elke module haar feitenbronnen:

```ts
export interface FactProvider {
  name: string;                       // 'erp.get_order'  == wat in toolScope staat
  mcp: string;                        // 'factumai-mcp-erp'
  tool: string;                       // 'get_order'
  dataCategories: DataCategory[];     // wat de MCP mag teruggeven
  input: (env: SignalEnvelope, resolved: Resolved) => Record<string, unknown> | null;
  /** null = deze bron is niet van toepassing op dit signaal, sla over */
}
```

Drie dingen worden hiermee tegelijk opgelost:

1. **`toolScope` gaat gelden.** De planner krijgt alleen feiten uit bronnen die
   in de `toolScope` van de gekozen specialist staan. Nu is dat een dood veld.
2. **`dataCategories` gaat mee op elke call.** De belofte uit `docs/RECHTEN.md`
   wordt waargemaakt in plaats van gedocumenteerd.
3. **Grounding wordt echt.** Elke feitrespons krijgt een `toolCallId` van de
   recorder. Een claim zonder dekking valt weg, ook in een nieuw domein.

Fail-soft blijft: een MCP die niet antwoordt levert `{ok:false}` en het feit
ontbreekt, de run gaat door en het item gaat naar review. Dat is bestaand gedrag
en het is goed.

---

## 6. De werkbak generiek maken

### 6.1 Eén detailroute in plaats van `/mail/[id]`

Nu: `ui/app/(dashboard)/mail/[id]/page.tsx` met `ui/components/mail-detail/*`.
Straks: `ui/app/(dashboard)/item/[id]/page.tsx` die op `moduleForRow(row)` de
renderer van de module ophaalt.

`WorkbenchModule` krijgt er twee velden bij:

```ts
  /** Rendert het detailscherm. Krijgt de rij, geeft React terug. */
  DetailView: (props: { row: ReviewItemRow; user: User }) => ReactNode;
  /** Hoe een bewerking terug naar `proposed` schrijft. */
  applyEdit: (row: ReviewItemRow, patch: unknown) => Record<string, unknown>;
```

Let op de spanning met `docs/MODULES.md`, dat zegt: een module levert geen React.
Die regel klopte voor de **kaart** (de schil tekent de kaart uit een viewmodel).
Voor het **detailscherm** houdt hij geen stand: een offerte met regels en een
werkbon met onderdelen zijn geen viewmodel-variaties van elkaar. Voorstel:
regel handhaven voor de kaart, expliciet loslaten voor het detailscherm, en dat
in `docs/MODULES.md` opschrijven met de reden. Anders bouw je een generieke
renderer die elke module half verkeerd tekent.

`/mail/[id]` blijft als redirect naar `/item/[id]` staan, want er staan links in
de auditlog en in verstuurde mails.

### 6.2 Modulekolom overal

Migraties nodig op: `aios_tickets`, `aios_conversations`, `aios_messages`
(via conversation), `aios_proposed_actions`, `aios_decision_logs`,
`aios_policy_rules`, `aios_memory_entries`, `aios_message_feedback`,
`aios_unknown_intent_log`, `aios_partial_responses`, `aios_automations`.
Overal `text not null default 'klantenservice'`, plus een index die met
`(organization_id, module, ...)` begint.

`aios_ticket_counters` krijgt de module in de primaire sleutel, zodat een
sales-ticket niet in dezelfde nummerreeks valt als een servicedesk-ticket.

### 6.3 Categorie-slugs namespacen

`allCategories()` gaat werken met `{ module, slug }` in plaats van alleen `slug`,
en `aios_policy_rules.applies_to` matcht op de combinatie. Zonder dit verdwijnt
bij de eerste gedeelde slug stilzwijgend een beleidsregel.

### 6.4 De lekken dichten

`analytics/page.tsx` en `audit/page.tsx` krijgen `getCurrentAccess()` en een
modulefilter. `api/audit/export` krijgt dezelfde controle als de pagina. Dit is
geen uitbreiding maar een bug die vandaag al latent is.

---

## 7. Aanzetten, uitzetten, upsellen

Dit is het commerciële hart en het staat er grotendeels al.

**Laag 1, afname.** `LICENSED_MODULES` als var op de cockpit-Worker. Die var moet
er ook op de **agent-Worker** komen, want die moet weten welke module-packs hij
laadt. Een module die niet is afgenomen, draait niet, ook niet als er een signaal
voor binnenkomt: dat signaal gaat naar `IGNORED` met een reden in het beslislog.

**Laag 2, toewijzing.** `allowed_emails.modules`. Bestaat.

**Laag 3, rol en categorie.** `aios_role_grants`. Bestaat.

**Nieuw, laag 0: instellingen binnen een module.** Niet elke klant wil elk
actietype. Nieuwe tabel:

```sql
create table aios_module_settings (
  organization_id text not null,
  module          text not null,
  enabled_actions text[] not null default '{}',   -- leeg = alles uit
  thresholds      jsonb  not null default '{}',   -- per actietype een bedrag
  settings        jsonb  not null default '{}',
  primary key (organization_id, module)
);
```

Daarmee is de upsell letterlijk: één var bijwerken, één rij bijwerken,
deployen. Geen code. Dat is wat je wilde.

**En de manifest wordt de bron.** `client.manifest.yaml` krijgt:

```yaml
modules:
  klantenservice:
    licensed: true
    actions: [antwoord_versturen, ticket_aanmaken]
  administratie:
    licensed: true
    actions: [betalingsherinnering_versturen]
    thresholds: { creditnota_voorstellen: 0 }
  sales:
    licensed: false
```

Een script leest dat en genereert de vars en de seed-SQL. Zo staat op één plek
per klant wat hij heeft, en dat is meteen het antwoord op "wat kan ik nog
verkopen".

---

## 8. Sneller en goedkoper

Je zei het expliciet: sneller en goedkoper werken. Dat gaat over twee dingen,
bouwkosten en draaikosten.

### 8.1 Draaikosten

| Ingreep | Effect |
| --- | --- |
| **Prompt caching** op de system-prompt, de categoriegids en het outputcontract | De classify- en gate-prompts zijn per module statisch. Dit is de grootste knop en hij kost een dag |
| Gate en classify samenvoegen tot één call per module | Nu twee calls, parallel. Eén call met twee velden in de JSON scheelt de helft van de classify-tokens |
| Geen `plan`-call bij uitkomst `kennis` met dekking uit RAG | Sonnet-call overslaan waar Haiku plus geheugen volstaat |
| Modelkeuze per module in `pack.models` | Administratie mag duurder plannen dan marketing. Nu is het één instelling voor alles |
| Feiten cachen per run | Dezelfde order wordt nu per specialist opnieuw opgehaald bij compound |

### 8.2 Bouwkosten

| Ingreep | Effect |
| --- | --- |
| Modulepakket als contract | Een nieuw domein is dan bestandjes vullen, geen kernbestanden bewerken |
| `scripts/new-module.sh <id> "<Label>"` | Genereert de map, de lege pack, de UI-registratie, de migratie en een testbestand |
| Gegenereerde registry | Haalt de twee bestanden weg waar klantmaatwerk en fundament-updates op botsen |
| Eval-set per module | Zonder dit durf je het fundament niet meer aan te raken zodra er vijf klanten op draaien. Zie 9 |
| Demo-scenario's per module in het fundament | Elke nieuwe klantdemo is dan configuratie, geen schrijfwerk |

---

## 9. Regressie: het echte risico

Zodra tien klantrepo's op dit fundament meeliften, is elke kernwijziging een
risico op tien plekken tegelijk. `upstream-sync.yml` draait typecheck, tests en
een build, en dat is goed, maar het zegt niets over gedrag: of de gate nog
weigert wat hij moet weigeren, of de classifier nog dezelfde categorie kiest.

Wat erbij moet:

1. **Golden set per module.** 30 tot 50 gelabelde signalen per domein met de
   verwachte categorie, specialist en uitkomst. Draaien tegen `FakeLlmClient` waar
   het kan en tegen het echte model in een nachtelijke run.
2. **`scripts/adversarial-gate.ts` per module.** Bestaat al, maar draait tegen de
   ene globale `DOMAIN`. Wordt: draai per module-pack met de eigen lijsten.
3. **Grounding-regressietest.** Een run waarin de MCP bewust niets teruggeeft moet
   een item zonder cijferclaims opleveren, niet een item met verzonnen cijfers.
4. **`check-module-guards.mjs` uitbreiden.** Nu een handmatige lijst
   `MODULE_ROUTES`. Wordt: elke route onder een modulemap moet een guard hebben,
   afgeleid uit de registry in plaats van uit een lijst die je vergeet bij te
   werken.
5. **Eval-drempel in CI.** Zakt de golden set onder een grens, dan geen merge.

Dit is het verschil tussen een fundament dat schaalt en een fundament dat na
klant vijf bevriest omdat niemand het nog durft te veranderen.

---

## 10. Fasering

Elke fase eindigt in iets dat draait en dat je kunt laten zien. Geen fase mag
langer duren dan een week werk, en geen fase laat de repo rood achter.

### Fase 0: hygiëne en guardrails
Modulekolommen, indexen, de twee lekken in analytics en audit, categorie-slugs
namespacen, golden set voor klantenservice, `check-module-guards` uit de registry.
Geen nieuwe functionaliteit. Dit is de fase die je overslaat als je haast hebt en
waar je daarna twee weken aan kwijt bent.

**Klaar als:** alle bestaande tests groen, analytics en audit tonen alleen de
modules waar de gebruiker in mag, en de golden set draait in CI.

### Fase 1: het modulepakket
`ModulePack`-contract, registry met `resolveModule()`, en klantenservice omgezet
naar `modules/klantenservice/` zonder één gedragswijziging. Dit is een refactor,
en de test is dat de golden set uit fase 0 exact dezelfde uitkomsten geeft.

**Klaar als:** `taxonomy/`, `domain-gate/` en `specialists/` bevatten geen
klantenservice-inhoud meer, en de golden set is byte-identiek.

### Fase 2: de triggerlaag
Envelop-model en hydrator-registry, webhook-route met HMAC, cron die
`aios_automations` leest, poll met cursors, uploadpad. Nog geen tweede module:
bewijs het met een klantenservice-cron die openstaande tickets opvolgt.

**Klaar als:** een signaal dat niet uit mail komt, loopt door de hele lus tot een
ReviewItem, en `orchestrate/index.ts` bevat het woord `from` niet meer.

### Fase 3: de feitenlaag
`FactProvider`, `toolScope` handhaven, `dataCategories` meesturen, de
hardgecodeerde lookups uit `steps.ts` slopen.

**Klaar als:** een specialist met een lege `toolScope` krijgt geen feiten, en
`steps.ts` bevat geen SQL meer.

### Fase 4: de generieke werkbak
`/item/[id]`, `DetailView` op de module, klantenservice-detailschermen verhuisd
naar `ui/lib/modules/klantenservice/`, `api/review/[id]` module-agnostisch.

**Klaar als:** `ui/components/mail-detail/` bestaat niet meer op die plek en de
werkbak gedraagt zich exact hetzelfde.

### Fase 5: module twee, administratie
Het echte bewijs van het contract. Volledig uit `domein-administratie.md`.
Als deze module gebouwd kan worden zonder één kernbestand te bewerken, klopt het
ontwerp. Lukt dat niet, dan is fase 1 tot 4 niet af en repareer je dat eerst.

**Klaar als:** de module is gebouwd zonder wijzigingen buiten
`packages/agent-core/src/modules/administratie/`, `ui/lib/modules/administratie/`,
de registry-generatie en een migratie.

### Fase 6: sales en supply chain
Nu gaat het snel, want het contract staat. Supply chain absorbeert
`examples/warehouse-module`.

### Fase 7: marketing en HR
Marketing vraagt de RAG-uitbreiding (GLOBAL en CLIENT worden nu niet gelezen).
HR vraagt de strengere rechten en de AI Act-inrichting. Beide zijn daarom later,
niet omdat ze minder waard zijn.

### Fase 8: verkoopbaar maken
`aios_module_settings`, manifest-gestuurde generatie, `new-module.sh`,
demo-scenario's per module, en de upsell-flow in de cockpit ("deze module heb je
niet, vraag aan").

---

## 11. Wat ik anders zou doen dan je nu van plan lijkt

Drie punten waar ik tegen je plan in ga.

**Bouw niet eerst alle domeinen half.** De verleiding is groot om vijf modules
tegelijk als lege huls neer te zetten zodat de demo breed oogt. Doe dat niet. Eén
module die echt werkt verkoopt beter dan vijf tabbladen met voorbeelddata, en het
past ook bij je eigen positionering: klein, op maat, precies. Bouw administratie
volledig af, en gebruik de blauwdrukken van de rest als gespreksmateriaal.
Prospects mogen best zien dat het ontwerp er ligt.

**De volgorde administratie voor sales is bewust.** Sales voelt makkelijker en je
bouwt het toch al voor jezelf. Maar sales is commodity (dat staat ook in je eigen
positioneringsdocument) en administratie is waar de herkenbare pijn zit bij 20 tot
100 FTE. Bovendien dwingt administratie de triggerlaag af, en die heb je overal
nodig. Sales laat je die luxe niet zien, want daar kun je met mail wegkomen.

**Zet de eval-set neer voordat je klant twee live hebt, niet erna.** Dit is de
saaiste aanbeveling in dit document en de belangrijkste. Je bouwt een fundament
waar straks tien klanten op draaien, met een wekelijkse automatische merge. Zonder
gedragstests is die merge een gok. Met tests is het een productlijn.

---

## 12. Bijlagen

| Document | Inhoud |
| --- | --- |
| `domein-administratie.md` | Volledige blauwdruk administratie en finance |
| `domein-supplychain.md` | Volledige blauwdruk supply chain en operations |
| `domein-sales.md` | Volledige blauwdruk sales |
| `domein-marketing.md` | Volledige blauwdruk marketing |
| `domein-hr.md` | Volledige blauwdruk HR en recruitment |
| `domein-catalogus.md` | Alle kandidaat-domeinen, prioritering, en de afvallers |
| `claude-code-opdrachten.md` | Fase voor fase de opdracht om in Claude Code te plakken |

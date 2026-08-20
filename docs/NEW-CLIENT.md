# Nieuwe klant opzetten

Van dit fundament naar een draaiende klant-agent. Reken op een halve dag voor de
technische opzet; de inhoudelijke afstemming (categorieën, beleid, toon) loopt
daarna door met de klant.

Werk de stappen in volgorde af. Elke stap eindigt met iets dat je kunt
controleren — sla dat niet over, want een fout in stap 2 zie je pas in stap 8.

---

## Stap 0 — repo aanmaken

```bash
./scripts/new-client.sh acme "Acme B.V."
```

Dat maakt `../acme-mail-agent` aan en doet meteen stap 1 en 2: slug en naam
overal ingevuld, remotes goedgezet, en typecheck + tests gedraaid. Daarna koppel
je de GitHub-repo:

```bash
cd ../acme-mail-agent
git remote add origin git@github.com:<org>/acme-mail-agent.git
git push -u origin main
```

**De klant-repo houdt het fundament als `upstream`.** Dat is bewust: zo haal je
later kernverbeteringen op met één commando (zie *Fundament-updates ophalen*
onderaan). Gooi die remote niet weg.

Zet meteen de repo-secrets die de deploy-workflow nodig heeft (Settings →
Secrets and variables → Actions):

| Wat                            | Waarvoor                                    |
| ------------------------------ | ------------------------------------------- |
| secret `CLOUDFLARE_API_TOKEN`  | deployen vanuit GitHub Actions              |
| secret `CLOUDFLARE_ACCOUNT_ID` | idem                                        |
| variable `FUNDAMENT_REPO`      | wekelijkse fundament-sync                   |
| secret `FUNDAMENT_DEPLOY_KEY`  | idem — zie *De deploy key aanmaken* onderaan |

De laatste twee zijn optioneel: ontbreken ze, dan slaat de sync schoon over.

**Controle:** `git remote -v` toont `origin` (de klant) en `upstream` (het
fundament), en `git diff upstream/main` toont precies vier gewijzigde
configbestanden — verder niets.

> Liever met de hand? Kloon het fundament, hernoem `origin` naar `upstream`, en
> vervang `__CLIENT_SLUG__` en `__CLIENT_NAME__` in `agents/mail-agent/wrangler.jsonc`,
> `ui/wrangler.jsonc`, `ui/supabase-magic-link-email.html` en
> `client.manifest.yaml`. Alléén in die vier: `DEPLOY.md`, `docs/NEW-CLIENT.md`
> en `.github/workflows/deploy.yml` noemen de placeholders omdat ze erover gaan,
> en de deploy-guard grept er zelfs op.

---

## Stap 1 — manifest afmaken

Slug en naam staan er al in. Vul de rest van `client.manifest.yaml`: welke
MCP's de klant heeft, de eerste use-case, en of je RAG en de demo aanzet.
`org_id` mag nog leeg — die krijg je in stap 3.

**Controle:** geen `<...>` meer in het bestand, behalve `org_id`/`test_org_id`.

---

## Stap 2 — placeholders (grotendeels al gedaan)

`new-client.sh` heeft slug en naam al ingevuld. Wat overblijft zijn de twee
org-id's, die je pas kent als de tenant bestaat. Voor de volledigheid, de vier
tokens:

| Token                    | Uit het manifest      | Voorbeeld                      |
| ------------------------ | --------------------- | ------------------------------ |
| `__CLIENT_SLUG__`        | `client.slug`         | `acme`                         |
| `__CLIENT_NAME__`        | `client.name`         | `Acme B.V.`                    |
| `__CLIENT_ORG_ID__`      | `client.org_id`       | `cmqq...` (stap 3)             |
| `__CLIENT_TEST_ORG_ID__` | `client.test_org_id`  | `cmqq...` (stap 9, optioneel)  |

**Controle:**

```bash
grep -n '__CLIENT' agents/mail-agent/wrangler.jsonc ui/wrangler.jsonc
```

Alleen `__CLIENT_ORG_ID__` en `__CLIENT_TEST_ORG_ID__` mogen nog staan. Zolang
`__CLIENT_ORG_ID__` er staat, weigert de deploy-workflow te draaien — dat is de
bedoeling: zonder tenant valt er niets zinnigs te deployen.

---

## Stap 3 — Supabase-project van de klant

1. Maak (of kies) het Supabase-project van de klant. Dit is **niet** de
   dashboard-DB, en ook niet het project van een andere klant: één klant, één
   database. Deelt de agent een database met een andere agent, dan botsen de
   work-bus (`aios_signals`) en de RPC-namen op elkaar.
2. Draai álle migraties uit `migrations/` op nummervolgorde.
   `0005_demo_testdata.sql` is optioneel — alleen nodig voor de demo. De rest
   niet: `0021` en `0022` zetten respectievelijk de RPC-grants dicht en maken
   de allowlist compleet.

**Controle:** drie dingen, in deze volgorde:

```sql
-- 1. Tabellen staan er.
select count(*) from aios_signals;                       -- 0, geen fout

-- 2. De RPC's zijn dicht voor anon/authenticated. Verwacht per functie
--    alleen postgres en service_role — géén anon, géén authenticated.
select proname, pg_catalog.array_to_string(proacl, ' | ')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname like 'aios%';

-- 3. De allowlist kent invited_by (anders faalt de Toegang-pagina).
select column_name from information_schema.columns
 where table_name = 'allowed_emails';
```

Staat er bij (2) toch `anon=X`? Dan is `0021` niet gedraaid. Draai 'm alsnog
voordat je verder gaat — met de publieke anon-key kan anders iedereen signalen
injecteren en de work-bus leegtrekken.

---

## Stap 3b — tenant in het dashboard

De agent haalt z'n MCP-credentials uit de vault in de dashboard-DB, niet uit de
klant-database. Daarom moet de klant ook dáár bestaan.

1. Maak de `Organization` aan in het FactumAI-dashboard en noteer het id.
2. Activeer de MCP's die deze klant gebruikt (`TenantMcpActivation`).
3. Zet de credentials per MCP in de vault (`OrganizationCredential`). De agent
   stuurt nooit secrets mee; de MCP resolvet ze zelf op tenant-id.
4. Vul `org_id` in `client.manifest.yaml` en vervang `__CLIENT_ORG_ID__` in
   `agents/mail-agent/wrangler.jsonc` én `ui/wrangler.jsonc`.

Het id uit stap 1 en de waarde in beide wrangler-configs moeten **exact** gelijk
zijn. Wijken ze af, dan draait de agent op een tenant die niet bestaat: de
cockpit blijft leeg zonder foutmelding, want alle queries filteren op een
`organization_id` waar niets onder staat.

**Controle:** `grep -n '__CLIENT_ORG_ID__' agents/mail-agent/wrangler.jsonc
ui/wrangler.jsonc` geeft niets meer terug.

---

## Stap 4 — taxonomie

Open `packages/agent-core/src/taxonomy/index.ts` en vervang de startset door de
categorieën van deze klant. Dit is de belangrijkste inhoudelijke stap: de
classifier kiest hieruit en het beleid matcht erop.

Vuistregel: een categorie verdient een eigen slug als er ánder beleid of een
andere specialist bij hoort. Anders hoort 'ie bij `overig`. Meestal kom je uit
op 8 à 12.

**Vul de `hint` in, altijd.** Die regel gaat mee de classify-prompt in
(`CATEGORY_GUIDE`) en is werkende configuratie, geen documentatie. Zonder hint
raadt het model de betekenis uit de naam, en dan valt een bericht in de
categorie die er het meest naar klínkt in plaats van waar het hoort — waarna het
beleid van díé categorie draait en de agent iets vraagt wat niemand wilde vragen.

Schrijf de **afbakening** op, niet de omschrijving. Noem vooral wanneer een
categorie *niet* van toepassing is, en waar het bericht dan wél heen moet:

```ts
// zwak — herhaalt de naam
{ slug: 'demo_aanvraag', label: 'Demo', specialist: 'escalate',
  hint: 'demo-aanvragen' }

// sterk — trekt de grens en wijst de andere kant aan
{ slug: 'demo_aanvraag', label: 'Demo', specialist: 'escalate',
  hint: 'ALLEEN als de bezoeker zelf om een demo of gesprek vraagt. Interesse ' +
        'tonen in een product is dit NIET — dat is product_vraag' }
```

**Controle:** `pnpm -r test` — de taxonomie-tests bewaken dat elke categorie
naar een bestaande specialist wijst, een label heeft, in `CATEGORY_GUIDE` staat
en een hint draagt.

---

## Stap 4b — domeingrens

Open `packages/agent-core/src/domain-gate/index.ts` en beschrijf waar deze klant
over gaat. Dit is de poort vóór de router: valt een bericht erbuiten, dan stopt
de run — geen specialist, geen tool-call, geen gegenereerde tekst. De klant
krijgt een **vaste** afwijzingstekst uit dezelfde config.

Drie dingen invullen:

- `description` — de sector en het soort vragen, niet de producten één voor één.
- `inScope` / `outOfScope` — wees ruim in `inScope`: bij twijfel laat de poort
  door, en dat is de bedoeling. `outOfScope` vul je met wat in de praktijk
  geprobeerd wordt.
- `rejectionText` — in de taal en toon van de klant. Deze tekst gaat letterlijk
  naar de klant en wordt nooit door een model aangeraakt.

Uitzetten kan met `DOMAIN_GATE=off` op de Worker; dan gaat elk bericht naar de
router. Alleen doen als je weet waarom.

**Controle:** `pnpm -r test` — de tests bewaken dat een afwijzing de lus
daadwerkelijk stopt en dat er niets uit het klantbericht in het antwoord
terechtkomt. Draai de adversariële lijst uit `domain-gate.test.ts` óók een keer
tegen het echte model voordat je chat aanzet: die tests meten de mechaniek, niet
het oordeel.

---

## Stap 5 — branding

1. `ui/lib/brand.ts` — naam, tagline, footer, eventueel een gesplitst logo.
2. `ui/app/globals.css` — de `--brand-*`, `--accent-*` en `--alert-*` kanalen.

Waarden zijn RGB-kanalen zonder wrapper (`51 65 85`), zodat opacity-varianten
als `bg-brand-900/40` blijven werken. Raak geen componenten aan: die gebruiken
uitsluitend tokens.

**Controle:** `cd ui && pnpm dev` — de werkbak draagt de kleuren van de klant en
er staat nergens meer "FactumAI" waar de klantnaam hoort.

---

## Stap 5b — modellen controleren

De model-IDs staan als `vars` in `agents/mail-agent/wrangler.jsonc`, niet in de
code. Controleer bij elke nieuwe klant of ze nog de huidige generatie zijn — het
fundament loopt hier makkelijk achter, en een klant erft wat er op dat moment in
staat.

| Var                 | Waarvoor                                  |
| ------------------- | ----------------------------------------- |
| `MODEL_CLASSIFY`    | Haiku-tier: classificeren en de domeingrens |
| `MODEL_PLAN`        | Sonnet-tier: plannen en opstellen          |
| `MODEL_PLAN_HEAVY`  | Opus-tier, optioneel: alleen `plan-heavy`  |

Zet `MODEL_PLAN_HEAVY` alleen als een specialist het echt nodig heeft; hij kost
een veelvoud van de Sonnet-tier.

---

## Stap 6 — secrets

Deploy eerst één keer (anders bestaat de Worker nog niet), zet dan de secrets:

```bash
cd agents/mail-agent && npx wrangler deploy
npx wrangler secret put AIOS_SUPABASE_URL
npx wrangler secret put AIOS_SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put FACTUMAI_MCP_MAIL_URL
# en de overige MCP-URL's + auth die deze klant gebruikt
```

Voor de cockpit hetzelfde, plus `SUPABASE_ANON_KEY` — zonder die key blijft de
werkbak fail-closed op slot.

Welke secrets er zijn en waarvoor, staat onderaan beide `wrangler.jsonc`-bestanden.

**Controle:** `npx wrangler secret list` toont wat je verwacht.

---

## Stap 6b — toegang tot de werkbak

Sla deze stap niet over: de cockpit is fail-closed, dus zonder deze stap kan
**niemand** inloggen — jij ook niet, en je kunt jezelf ook niet via de UI
toevoegen.

**1. Eenmalig in Supabase** (project → Authentication → Email Templates): zet de
template op de OTP-code (`{{ .Token }}`) in plaats van de magic-link. Een
voorbeeld staat in `ui/supabase-magic-link-email.html`. Zonder dit komen
uitnodigingen wel aan, maar met een link die niet werkt.

**2. De eerste beheerder** met de hand in de tabel:

```sql
insert into public.allowed_emails (email, role)
values ('<beheerder@klant.nl>', 'admin')
on conflict (email) do nothing;
```

Een rij mag ook een heel domein zijn, geschreven als `@klant.nl`. Iedereen met
zo'n adres krijgt dan die rol, zonder aparte uitnodiging:

```sql
insert into public.allowed_emails (email, role)
values ('@klant.nl', 'reviewer')
on conflict (email) do nothing;
```

Een persoonlijke rij gaat vóór de domeinregel, dus je kunt één iemand
promoveren of met `viewer` terugschroeven zonder het domein aan te passen.

Wees terughoudend met een domeinregel op `admin`: iedereen die een adres op dat
domein via Supabase Auth kan laten verifiëren, komt binnen als beheerder. Zet er
alleen een domein in dat de klant zelf beheert.

Daarna nodigt die beheerder de rest uit via de **Toegang**-pagina.

**Controle:** log in op de cockpit-URL met het adres uit stap 2. Je komt in de
werkbak en ziet **Toegang** in de navigatie.

---

## Stap 7 — mail-MCP koppelen

Laat de mail-MCP `mail.received`-signalen naar de klant-DB emitten via
`aios_emit_signal`. Zonder deze stap blijft de werkbak leeg, hoe goed de agent
verder ook staat.

**Controle:** stuur een testmail naar de gekoppelde mailbox en kijk of er een rij
in `aios_signals` verschijnt.

---

## Stap 8 — demo (optioneel, aanrader)

Zet `DEMO_MODE: "true"` in `ui/wrangler.jsonc` → `vars` en deploy de cockpit.
Er verschijnt dan een **Demo**-item in de navigatie (admin-only) waarmee je
synthetische mails door de echte pipeline stuurt.

Pas `ui/lib/demo/scenarios.ts` aan naar mails die déze klant herkent — een demo
werkt pas als de prospect z'n eigen werkelijkheid ziet. Houd de ordernummers
gelijk aan de seed in `migrations/0005_demo_testdata.sql`, anders vindt de agent
geen order en heeft de grounding-check niets te verifiëren.

**Zet `DEMO_MODE` nooit aan op een productie-cockpit.**

**Controle:** klik "Start demo" → binnen een minuut staan er concepten in de
werkbak, met grounding-verwijzingen naar de order-lookups.

---

## Stap 9 — staging (optioneel)

Wil je een testomgeving naast productie: maak een test-tenant (child-org), zet
de cuid in `__CLIENT_TEST_ORG_ID__` en deploy met `--env staging`. Achtergrond
staat in `docs/MULTI-ENV-DESIGN.md`.

---

## Stap 10 — inhoud met de klant

Wat overblijft is geen configuratie meer maar afstemming:

- Beleidsregels aanmaken in de cockpit (Beleid-pagina, admin-only).
- Tone-of-voice en SOP's als memory-entries, als je RAG aanzet.
- De eerste weken meekijken in de werkbak: wat de reviewers corrigeren, is het
  leersignaal waarop je de prompts en het beleid bijstelt.

---

## Fundament-updates ophalen

De klant-repo houdt het fundament als `upstream`. Er gebeurt niets vanzelf: een
commit in het fundament raakt deze klant pas als je 'm binnenhaalt.

### Automatisch, via de sync-workflow

`.github/workflows/upstream-sync.yml` kijkt of het fundament vooruit is. Dat
gebeurt op twee momenten:

- **direct**, zodra er iets op `main` van het fundament landt — het fundament
  stoot deze repo dan aan (zie *Direct aanstoten* hieronder);
- **elke maandagochtend** als vangnet, voor het geval dat aanstoten niet
  aankwam (token verlopen, repo hernoemd, klant nog niet in de lijst).

Wat er dan gebeurt hangt af van jouw maatwerk:

| Situatie                                   | Wat de workflow doet                          |
| ------------------------------------------ | --------------------------------------------- |
| Schoon te mergen én typecheck/tests groen  | mergt naar `main` en start Deploy              |
| Conflict met maatwerk                      | opent een PR, `main` blijft ongemoeid          |
| Schoon, maar tests of build falen erna     | opent een PR, `main` blijft ongemoeid          |
| Update raakt `.github/workflows/`          | doet niets, en zegt met de hand op te halen    |

Die laatste is geen keuze maar een platformregel: de `GITHUB_TOKEN` van Actions
mag geen workflow-bestanden schrijven. Ook niet via de PR-route, want die pusht
dezelfde bestanden. De workflow stelt dat vooraf vast en stopt met een
werkinstructie in de run-samenvatting, in plaats van halverwege te falen op een
`remote rejected`.

Zo'n update haal je met de hand op:

```bash
git fetch upstream && git merge upstream/main
pnpm install && pnpm -r typecheck && pnpm -r test
git push
```

Wil je het tóch automatisch, dan heeft de klant-repo een token met
**Workflows: write** nodig en moet de push dat token gebruiken in plaats van
`GITHUB_TOKEN`. Weeg dat bewust: zo'n token mag de CI van die repo
herschrijven, en het ligt in een repo-secret.

Eenmalig instellen in de klant-repo:

| Wat                            | Waarde                                        |
| ------------------------------ | --------------------------------------------- |
| variable `FUNDAMENT_REPO`      | `<org>/mail-agent-fundament`                  |
| secret `FUNDAMENT_DEPLOY_KEY`  | privé-helft van een read-only **deploy key**  |

Ontbreekt er een? Dan slaat de workflow schoon over — hij faalt niet.

#### Direct aanstoten

Zonder dit blijft een kernverbetering tot maandagochtend liggen. Het aanstoten
gebeurt vanuit **het fundament**, niet vanuit de klant:
`.github/workflows/notify-clients.yml` draait daar bij elke push naar `main` en
start `upstream-sync.yml` in elke klant-repo.

Eenmalig instellen, in het **fundament**:

| Wat                             | Waarde                                                   |
| ------------------------------- | -------------------------------------------------------- |
| variable `CLIENT_REPOS`         | de klant-repo's, één per regel of komma-gescheiden        |
| secret `CLIENT_DISPATCH_TOKEN`  | fine-grained PAT, **alleen** `Actions: Read and write` op precies die repo's |

Bij een nieuwe klant is dat één regel erbij in `CLIENT_REPOS`. Geen commit op
het fundament — klantnamen horen niet in de code (zie `CLAUDE.md`), en daarom
staat de lijst in een variabele.

Drie dingen om te weten:

- **`GITHUB_TOKEN` kan dit niet.** Die komt de grens van de eigen repo niet
  over; cross-repo dispatch vraagt een eigen token. Dat is een echt recht:
  wie dat token heeft, kan workflows starten in elke klant-repo die erin
  staat. Scope 'm daarom strak en zet er niets anders op dan Actions.
- **De beslissing blijft bij de klant.** Aanstoten betekent alleen "kijk nu",
  niet "merge nu". Schoon + groen gaat door, een conflict wordt nog steeds een
  PR. Deze workflow verandert het moment, niet de uitkomst.
- **Eén onbereikbare klant houdt de rest niet tegen.** Mislukt er één, dan
  komt er een waarschuwing en gaan de andere door; de maandag-cron haalt die
  ene alsnog op.

Niet ingesteld? Dan gebeurt er niets en blijft alleen de maandag-cron over.

#### De deploy key aanmaken

Het fundament is privé, dus de klant-repo heeft leesrechten nodig. Een deploy
key is daar de juiste sleutel voor: hij geeft toegang tot **precies één repo**,
alleen **lezen**, en **verloopt niet**. Eén keer maken, daarna nooit meer naar
omkijken — in tegenstelling tot een personal access token, dat je jaarlijks moet
vervangen in elke klant-repo.

Maak 'm één keer aan, lokaal:

```bash
ssh-keygen -t ed25519 -f fundament-key -N "" -C "fundament-sync"
```

Dat levert twee bestanden op:

1. `fundament-key.pub` (openbaar) → in de **fundament**-repo:
   Settings → Deploy keys → *Add deploy key*. Titel bijvoorbeeld
   `upstream-sync`. **Laat "Allow write access" uit.**
2. `fundament-key` (privé) → in **elke klant-repo**: Settings → Secrets and
   variables → Actions → *New repository secret*, naam `FUNDAMENT_DEPLOY_KEY`,
   plak de volledige inhoud inclusief de `-----BEGIN`- en `-----END`-regels.

Bewaar de privésleutel in je wachtwoordmanager en verwijder beide bestanden van
je schijf. Dezelfde sleutel mag je voor alle klant-repo's gebruiken: hij kan
toch alleen lezen, en alleen dit ene fundament.

Raakt de sleutel kwijt of op straat: verwijder de deploy key in de
fundament-repo en maak een nieuwe. Alleen dán is er werk per klant-repo.

> Let op wat de eerste rij betekent: een geslaagde sync deployt naar productie.
> Wil je dat niet, zet de schedule dan uit en draai 'm handmatig via
> **Actions → Upstream-sync → Run workflow**.

### Met de hand

```bash
git fetch upstream
git log --oneline HEAD..upstream/main    # wat komt eraan?
git merge upstream/main
pnpm install && pnpm -r typecheck && pnpm -r test
git push                                 # nu pas gaat 'ie live
```

Hoever loopt een klant achter?

```bash
git fetch upstream && git log --oneline HEAD..upstream/main | wc -l
```

### Updates met een migratie erbij

De sync-workflow raakt de database niet aan. Zit er een migratie in de update,
dan moet die met de hand op het Supabase-project van de klant draaien, en de
volgorde luistert: **eerst de migratie, dan de deploy.** Andersom draait er even
code tegen een schema dat de kolom nog niet heeft.

Wat er per update te draaien valt, staat in `migrations/README.md`. Twee
migraties vragen daarnaast iets van jou:

| Migratie | Wat je zelf moet doen |
| --- | --- |
| `0021_revoke_security_definer` | Verplicht op elke bestaande database — hij zet RPC-grants dicht |
| `0035_module_columns` | Zie hieronder |

**Bij `0035_module_columns`:**

1. Draai de migratie vóór je de agent-Worker en de cockpit deployt. Hij zet een
   `module`-kolom op elke werk- en kennistabel, met `klantenservice` als
   backfill en default — bestaande rijen kloppen dus meteen.
2. De teller voor ticketnummers loopt daarna per module. De oude
   drie-argument-RPC blijft bestaan en trekt uit de klantenservice-reeks, dus
   een Worker die nog niet gedeployd is blijft werken. Lopende nummerreeksen
   breken niet.
3. `aios_policy_rules.applies_to` gaat van kale slugs naar `module:slug`. De
   migratie zet bestaande regels om naar `klantenservice:<slug>`. Heb je zelf
   regels aangemaakt buiten de cockpit om, controleer die dan na afloop in
   **Beleid**: een regel waarvan de categorieën leeg staan, matcht nergens meer.
4. Draai je de migratie later dan de deploy, dan blijft je beleid werken: een
   kale slug matcht voorlopig nog in elke module. Zodra er een tweede module
   bijkomt is dat niet meer wat je wilt, dus stel het niet uit.

Heb je **eigen tabellen** met werk of kennis van één proces (een magazijnmodule,
een eigen ticketsysteem)? Zet daar dezelfde kolom en index op, in een eigen
migratie op het eerstvolgende vrije nummer. Zonder die kolom valt jouw tabel
buiten elke modulezeef, en dan lekt hij straks over de afdelingen heen.

## Maatwerk en fundament-updates

Een conflict is geen storing: het is het fundament dat een bestand raakt dat jij
voor deze klant hebt aangepast. Hoe vaak dat gebeurt, hangt af van wáár je het
maatwerk hebt gezet.

**Op een extensiepunt — verwacht, en prima.**
`taxonomy/index.ts`, `ui/lib/brand.ts`, `globals.css`, de wrangler-configs,
`domain/index.ts`, `audit-sources.ts`, `demo/scenarios.ts`. Deze bestanden zijn
bedoeld om per klant af te wijken. Het fundament raakt ze zelden, en als het
gebeurt is het conflict klein en leesbaar. Vuistregel bij het oplossen: **de
klant-versie wint**, en je neemt alleen over wat je bewust wilt.

**In een nieuw bestand — nooit een conflict.**
Een eigen domeinmodule (`agents/mail-agent/src/warehouse/`, extra cockpit-
pagina's, eigen migraties) bestaat niet in het fundament, dus er valt niets te
conflicteren. Dit is de goedkoopste plek voor maatwerk. Zie
`examples/warehouse-module/`.

**Middenin een kernbestand — hier gaat het pijn doen.**
Pas je `orchestrate/index.ts`, een Workflow of een gedeelde cockpit-component
aan, dan conflicteert dat bestand bij élke fundament-update die het raakt, tot
in lengte van dagen. Twee uitwegen, allebei beter dan volhouden:

1. **Verplaats het naar een extensiepunt.** Meestal kan het — en kan het niet,
   dan ontbreekt er een naad, en is dát de echte bevinding.
2. **Breng het terug naar het fundament.** Wil de volgende klant dit ook, dan
   hoort het in de kern en verdwijnt het conflict permanent.

Zit je in geval 3 en werkt geen van beide uitwegen, leg dan in de klant-repo
vast *waarom* — een regel in `client.manifest.yaml` onder `notes` volstaat.
Anders staat de volgende die het conflict oplost voor een raadsel.

### De andere kant op

Blijkt tijdens klantwerk dat je iets hebt gebouwd dat élke klant wil, breng het
dan terug naar het fundament — dat is hoe het beter wordt. Werk in de klant-repo
op een aparte branch die *alleen* die verandering bevat (geen klantnamen, geen
org-id's), en push 'm naar het fundament:

```bash
git checkout -b kern/betere-grounding upstream/main
# … alleen de kernwijziging …
git push upstream kern/betere-grounding
```

Zo blijft de klant-specifieke commit-historie uit het fundament.

---

## Klant met een eigen domeinmodule

Heeft de klant een magazijn, planning of ticketsysteem dat aan de mailafhandeling
hangt? Begin dan bij `examples/warehouse-module/README.md` — dat is een complete
werkende module met alle aanhaakpunten erin.

## Klant met chat naast mail

Zie `docs/CHANNELS.md`. De lus is al kanaal-onafhankelijk; wat er nog moet
gebeuren staat daar beschreven, inclusief de autonomie-vraag die realtime chat
oproept.

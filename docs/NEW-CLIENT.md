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

## Stap 3 — Supabase + tenant

1. Maak (of kies) het Supabase-project van de klant. Dit is **niet** de
   dashboard-DB.
2. Draai de migraties uit `migrations/` op volgorde. `0005_demo_testdata.sql`
   is optioneel — alleen nodig als je de demo wilt gebruiken.
3. Maak de FactumAI-org aan en noteer de cuid.
4. Vul `org_id` in het manifest en vervang `__CLIENT_ORG_ID__` in
   `agents/mail-agent/wrangler.jsonc` en `ui/wrangler.jsonc`.

**Controle:** `select count(*) from aios_signals;` geeft `0` in plaats van een
foutmelding.

---

## Stap 4 — taxonomie

Open `packages/agent-core/src/taxonomy/index.ts` en vervang de startset door de
categorieën van deze klant. Dit is de belangrijkste inhoudelijke stap: de
classifier kiest hieruit en het beleid matcht erop.

Vuistregel: een categorie verdient een eigen slug als er ánder beleid of een
andere specialist bij hoort. Anders hoort 'ie bij `overig`. Meestal kom je uit
op 8 à 12.

**Controle:** `pnpm -r test` — de taxonomie-tests bewaken dat elke categorie
naar een bestaande specialist wijst en een label heeft.

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

De klant-repo houdt het fundament als `upstream`. Een verbetering in de kern —
een bugfix in de grounding, een nieuwe specialist, een scherpere prompt — haal
je zo binnen:

```bash
git fetch upstream
git log --oneline HEAD..upstream/main    # wat komt eraan?
git merge upstream/main
```

Verwacht conflicten op precies de bestanden die je per klant hebt aangepast:
`taxonomy/index.ts`, `ui/lib/brand.ts`, `globals.css` en de wrangler-configs.
Dat is geen ongemak maar informatie: het conflict laat exact zien waar deze
klant van de kern afwijkt. Kies bij zo'n conflict standaard de klant-versie, en
neem alleen over wat je echt wilt.

Daarna `pnpm install && pnpm -r typecheck && pnpm -r test`, en pas daarna
deployen.

Wil je zien hoever een klant achterloopt:

```bash
git fetch upstream && git log --oneline HEAD..upstream/main | wc -l
```

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

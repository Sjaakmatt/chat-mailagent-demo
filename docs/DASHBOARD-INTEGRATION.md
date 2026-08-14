# Dashboard-integratie — fundament-tracking

**Doelgroep:** een Claude Code-sessie die in de **FactumAI-dashboard**-repo werkt.
Dit document staat in het mail-agent-fundament omdat het fundament de kant is die
de gegevens levert; je bouwt zelf niets in deze repo.

Lees dit helemaal voor je begint. Er staat één technische valkuil in (§4) die
een halve dag kost als je 'm te laat ontdekt.

---

## 1. Wat we willen bereiken

FactumAI levert twee soorten opdrachten:

- **Maatwerk** — een eenmalig bouwsel voor één klant. Geen fundament, geen
  updates, niets te volgen.
- **Product** — de klant draait een instantie van een FactumAI-product
  (mail-agent, later chat-agent, …). Zo'n repo is gescaffold uit het fundament
  van dat product en hoort kernverbeteringen te blijven krijgen.

Voor die tweede groep willen we in het dashboard:

1. Per klant vastleggen dat het **product** is, en **welk** product.
2. Zien wie op welk fundament meelift, en hoever elke klant achterloopt.
3. Een melding krijgen zodra een klant-repo **niet meer vanzelf naar `main` kan**
   — want dan blijft die klant stilstaan op een oude kern, en dat merkt nu
   niemand.

Dat laatste is de kern. De rest is administratie.

---

## 2. Wat er aan de fundament-kant al staat

Elke klant-repo die uit een fundament is gescaffold heeft dit, ongewijzigd:

| Onderdeel | Wat het is |
| --------- | ---------- |
| `client.manifest.yaml` | Zelfbeschrijving van de repo — zie §3. **Dit is het contract.** |
| `.github/workflows/upstream-sync.yml` | Draait maandagochtend; haalt fundament-updates op. |
| `.github/workflows/deploy.yml` | Rolt uit naar Cloudflare bij een push naar `main`. |
| `.github/workflows/ci.yml` | Typecheck, tests, cockpit-build op elke push. |
| remote `upstream` | Wijst naar de fundament-repo (alleen lokaal, niet in CI). |

De sync-workflow heeft precies twee uitkomsten, en dát is het signaal dat je
wilt volgen:

| Situatie | Gedrag | Wat het dashboard moet tonen |
| -------- | ------ | ---------------------------- |
| Schoon te mergen én tests groen | mergt naar `main`, start Deploy | groen, niets aan de hand |
| **Conflict met maatwerk** | opent PR `upstream-sync`, `main` blijft staan | **melding** |
| Schoon, maar tests/build falen erna | opent PR `upstream-sync`, `main` blijft staan | **melding** |
| Config ontbreekt (deploy key of variable) | slaat stil over | **melding** — zie §6, dit is een valkuil |

De PR heet altijd `Fundament-update ophalen` en komt van branch `upstream-sync`
naar `main`.

---

## 3. Het contract: `client.manifest.yaml`

Elke klant-repo bevat dit blok in de root. Laat de klant-repo zichzelf
beschrijven; dupliceer die kennis niet in het dashboard.

```yaml
client:
  slug: "acme"
  name: "Acme B.V."
  org_id: "cmqq..."          # FactumAI org-id (cuid) — koppelt aan je bestaande Client

product:
  tier: "product"            # 'product' | 'maatwerk'
  kind: "mail"               # mail | chat | ...
  fundament: "org/mail-agent-fundament"
  repo: "org/acme-mail-agent"
```

**Gebruik `client.org_id` als sleutel** naar de Client die je al in het dashboard
hebt. Bouw geen tweede identiteit.

Bij `tier: "maatwerk"` zijn `kind` en `fundament` leeg en is er geen
sync-workflow. Toon voor die klanten géén sync-status — een leeg vinkje is
verwarrender dan niets.

Ouder repo's kunnen dit blok nog missen. Behandel een ontbrekend `product:`-blok
als *onbekend*, niet als maatwerk, en laat het dashboard dat expliciet tonen:
"herkomst niet vastgelegd". Dan zie je welke repo's nog bijgewerkt moeten worden.

---

## 4. De valkuil: cross-repo compare werkt hier niet

De voor de hand liggende aanpak is de GitHub compare-API gebruiken om te zien
hoever een klant achterloopt:

```
GET /repos/{owner}/{repo}/compare/{base}...{fundament-owner}:{branch}
```

**Dat werkt hier waarschijnlijk niet.** Die API vergelijkt alleen binnen één
*repository network* — dus tussen een repo en zijn forks. Onze klant-repo's zijn
**klonen**, geen forks: `new-client.sh` doet `git clone` en hernoemt de remote.
Ze delen wel history, maar GitHub kent ze niet als familie, en de call geeft dan
404.

Verifieer dat eerst met één echte klant-repo voor je erop bouwt. Blijkt het toch
te werken, prima — dan is polling de simpelste weg. Zo niet, kies dan één van
deze twee:

**A. Push-gebaseerd (aanbevolen).** De sync-workflow weet zelf al hoeveel
commits hij achterloopt en of het schoon te mergen was. Laat 'm dat na afloop
naar het dashboard sturen. Voordelen: geen 404-gedoe, geen polling-quota, en het
dashboard is meteen bij. Nadeel: elke klant-repo heeft een dashboard-endpoint en
een token nodig. Wat je aan de fundament-kant moet aanvragen staat in §7.

**B. Repo's als echte forks.** Maak nieuwe klant-repo's aan met *Fork* in plaats
van clone; dan werkt de compare-API wel. Overweeg dit alleen als je van voren af
aan begint — bestaande klanten omzetten is meer werk dan optie A, en forks van
privé-repo's brengen eigen beperkingen mee (zichtbaarheid, PR-defaults die naar
upstream wijzen).

Ga niet zelf repo's klonen op de dashboard-server om lokaal te diffen. Dat is
traag, vergt schrijfrechten en loopt uit de pas.

---

## 5. Wat je zonder compare-API wél betrouwbaar kunt lezen

Ook zonder §4 opgelost te hebben, geven deze calls je het belangrijkste signaal —
namelijk of een klant **vastloopt**. Read-only, en ze werken op elke repo.

**Openstaande sync-PR** (= deze klant kan niet vanzelf naar `main`):

```
GET /repos/{owner}/{repo}/pulls?state=open&head={owner}:upstream-sync
```

Is er een resultaat, dan staat die klant stil. Haal daarna de PR zelf op voor de
mergebaarheid:

```
GET /repos/{owner}/{repo}/pulls/{number}
→ mergeable_state: "dirty"   = conflict met maatwerk
→ mergeable_state: "blocked" = checks rood
```

`mergeable` en `mergeable_state` worden **asynchroon** berekend. Direct na het
aanmaken van een PR is `mergeable` nog `null`. Behandel `null` als "nog
onbekend" en probeer het later opnieuw; interpreteer het niet als "geen
conflict".

**Laatste sync-run** (= draait de sync eigenlijk nog?):

```
GET /repos/{owner}/{repo}/actions/workflows/upstream-sync.yml/runs?per_page=1
→ conclusion + created_at
```

**Het manifest** (= herkomst van de repo):

```
GET /repos/{owner}/{repo}/contents/client.manifest.yaml
```

Rechten: een fine-grained token met **Contents: read**, **Pull requests: read**
en **Actions: read** op de klant-repo's volstaat. Schrijfrechten heeft het
dashboard niet nodig, en hoort het niet te hebben — zie §8.

---

## 6. Wanneer een melding

Pop 'm op als er iets is dat **jij moet doen**. Niet bij normale voortgang.

| Melding | Voorwaarde | Waarom |
| ------- | ---------- | ------ |
| **Klant loopt vast op fundament-update** | open PR `upstream-sync`, `mergeable_state = dirty` | Maatwerk botst met de kern; iemand moet het conflict oplossen. |
| **Fundament-update faalt op tests** | open PR `upstream-sync`, `mergeable_state = blocked` | Merge kan wel, maar de kern sluit niet aan op deze klant. |
| **Sync draait niet meer** | geen sync-run in de laatste 14 dagen | Meestal ontbrekende config of een uitgeschakelde schedule. Dit is de stilste faalvorm en daarom de belangrijkste melding. |
| **Herkomst onbekend** | geen `product:`-blok in het manifest | Repo is nog niet bijgewerkt naar het contract. |

Twee dingen om niet te doen:

- **Geen melding bij "loopt N commits achter".** Achterlopen is normaal en
  meestal ongevaarlijk; er komt vanzelf een sync. Melden bij elk verschil leert
  mensen meldingen wegklikken, en dan mis je de conflicten ook.
- **Onderdruk herhaling.** Eén open sync-PR is één melding, niet elke poll
  opnieuw. Koppel de melding aan het PR-nummer en sluit 'm als de PR dicht gaat.

GitHub schakelt geplande workflows uit in repo's zonder activiteit gedurende
60 dagen. Dat is een reële oorzaak van "sync draait niet meer" bij een klant die
een tijd stil ligt — noem dat in de meldingstekst, dan hoeft niemand het te
onthouden.

---

## 7. Als je voor optie A kiest — wat het fundament moet leveren

Push-gebaseerd rapporteren vereist een wijziging in `upstream-sync.yml`, en die
hoort in het fundament thuis (dan krijgt elke klant 'm bij de volgende sync).
Vraag daarom een aanpassing aan in **mail-agent-fundament** in plaats van 'm per
klant-repo te plakken. Voorgestelde payload:

```jsonc
POST <dashboard>/api/agent-repos/sync-report
{
  "orgId":       "cmqq...",           // uit client.manifest.yaml
  "repo":        "org/acme-mail-agent",
  "product":     "mail",
  "fundament":   "org/mail-agent-fundament",
  "behind":      3,                    // commits achter op fundament/main
  "outcome":     "merged",             // merged | pr_conflict | pr_tests_failed | up_to_date
  "prNumber":    41,                   // aanwezig bij de pr_*-uitkomsten
  "runUrl":      "https://github.com/...",
  "at":          "2026-08-17T06:04:11Z"
}
```

Auth: één gedeeld secret per klant-repo (`DASHBOARD_TOKEN`), en het dashboard
controleert dat de `repo` in de payload hoort bij de `orgId`. Vertrouw de
payload verder niet blind — hij komt uit een repo, niet uit een beveiligde bron.

Houd het endpoint **idempotent** op `(repo, runUrl)`: een herdraaide workflow
mag geen tweede melding opleveren.

---

## 8. Wat je niet moet bouwen

**Geen merge-knop in het dashboard.** Verleidelijk, maar een merge naar `main` in
een klant-repo triggert een deploy naar een agent die echte klanten mailt. Dat
hoort een bewuste handeling te zijn in de repo, met de tests ernaast — niet een
klik in een overzichtsscherm. Het dashboard signaleert; het grijpt niet in.

**Geen secrets in het dashboard.** Cloudflare-tokens, Supabase-keys en de
deploy key horen bij de Worker en de repo. Het dashboard heeft alleen
leesrechten op GitHub nodig.

**Geen tweede waarheid over klanten.** Slug, naam, product en fundament staan in
`client.manifest.yaml` in de klant-repo. Lees ze daar; cache ze desnoods, maar
maak ze niet bewerkbaar in het dashboard — dan lopen ze uit de pas en weet je
niet meer welke klopt.

---

## 9. Aanbevolen volgorde

1. Datamodel uitbreiden: `tier`, `product`, `fundamentRepo`, `clientRepo` op de
   bestaande Client, gekoppeld op `org_id`.
2. Handmatig invoerscherm daarvoor — dan is de administratie meteen op orde,
   ook voor maatwerk-klanten.
3. Eén klant-repo uitlezen: manifest + open sync-PR + laatste sync-run.
   Verifieer hier meteen de aanname uit §4.
4. Meldingen uit §6, te beginnen met de conflict-melding — die heeft de meeste
   waarde per regel code.
5. Pas daarna eventueel §7 (push-rapportage) voor "hoever achter".

Stap 3 is het moment waarop je leert of §4 klopt. Doe die vroeg, niet laatst.

# Rechten — wie mag wat zien en goedkeuren

Eén rechtenmodel, geen tweede ernaast. De rol die bepaalt wat iemand mag
**goedkeuren** in de werkbak is dezelfde rol die bepaalt wat hij mag **zien**.

Wat erbij komt: een rol mag dat niet meer overal in gelijke mate.

## Twee assen

| As | Wat het beslist | Waarom |
| --- | --- | --- |
| **module** | Of je in dit proces mag werken | Een salesmedewerker hoort geen administratie-item goed te keuren, ook niet als hij `reviewer` is |
| **categorie** | Hoe diep je binnen dat proces mag kijken | Een medewerker ziet de orderstatus, niet de marge |

De rollen blijven `admin | reviewer | viewer` uit `allowed_emails` — er komt geen
tweede gebruikerstabel bij.

## De drie datacategorieën

| Categorie | Wat erin valt |
| --- | --- |
| `operationeel` | Orderstatus, voorraad, verzending, retouren, tickets, gespreksgeschiedenis, doorlooptijden |
| `commercieel` | Klantomzet, bestelfrequentie, gemiddelde orderwaarde, kortingen, prijsafspraken |
| `financieel` | Inkoopprijzen, marges, kostprijzen, betaalgedrag, openstaande posten |

**Een veld zonder categorie is voor niemand opvraagbaar**, ook niet voor een
beheerder. Dat wordt aan MCP-zijde afgedwongen; zie
`docs/VELDCLASSIFICATIE.md` in `factumai-mcps`.

**Afgeleide waarden erven de zwaarste categorie van hun bronnen.** Een marge komt
uit een verkoopprijs (commercieel) en een inkoopprijs (financieel), dus is de
marge financieel. Daarom kan een medewerkersrol er ook niet indirect bij: hij
stuurt `['operationeel']` mee, en de MCP houdt elk zwaarder veld tegen — of dat
nu een inkoopprijs is of een getal dat eruit berekend is.

## Waar het staat

`aios_role_grants`, per tenant:

```
organization_id | role     | module | categories
----------------+----------+--------+---------------------------------------
org_x           | reviewer | *      | {operationeel}
org_x           | reviewer | sales  | {operationeel,commercieel}
org_x           | admin    | *      | {operationeel,commercieel,financieel}
```

`'*'` is de bodem, een rij op de module zelf gaat erbovenop. Zo is "iedereen
operationeel, behalve in sales" uitdrukbaar zonder elke module op te sommen.

Geen rijen voor een tenant → `DEFAULT_ROLE_GRANTS` uit agent-core. Bewust
fail-**safe** en niet fail-closed: een cockpit die na een databasehapering
niemand meer binnenlaat is een storing, en de onderkant van dat voorstel
(operationeel) lekt niets. Zodra een rol wél een rij heeft, geldt die rij — ook
als hij strenger is dan de standaard, want anders was de terugval een achterdeur.

Het standaardvoorstel staat in de Toegang-pagina, met de melding erbij dát het
de standaard is. "Leeg" en "bewust zo ingesteld" zien er anders identiek uit.

## Waar het wordt afgedwongen

| Plek | Wat |
| --- | --- |
| `ui/app/(dashboard)/page.tsx` | Alleen tabs en items van modules waar je in mag |
| `ui/app/api/review/[id]/route.ts` | Goedkeuren/afwijzen checkt de modulegrant ná het ophalen — vóórdat je het item hebt, weet je niet uit welk proces het komt |
| `ui/app/api/review/[id]/draft/route.ts` | Idem bij bewerken: een concept aanpassen is meebeslissen over wat naar buiten gaat |
| MCP-laag | Snijdt elk antwoord bij op de meegestuurde `dataCategories` |

Items uit een module waar je niet in mag, worden **zonder melding** overgeslagen.
Dat er werk ligt in een proces waar je niet bij hoort, is zelf ook informatie.

## De agent is geen gebruiker

De orchestrator heeft geen rol — hij beantwoordt de vraag van een klant over
diens eigen order. Zijn scope staat in `AGENT_DATA_CATEGORIES` (var in
`wrangler.jsonc`), standaard `operationeel,commercieel`.

Financieel staat er bewust niet bij: inkoopprijzen en marges horen niet in een
antwoord aan een klant, en een agent die ze niet kan ópvragen kan ze ook niet per
ongeluk citeren. Verruimen is een bewuste keuze per klant.

Zonder deze var zou de agent sinds de veldclassificatie alleen `operationeel`
krijgen — en dan verdwijnen orderbedragen stilletjes uit zijn antwoorden.

## Bij een vraag buiten de rol

De assistent (stap 3) zegt dát het buiten zijn rechten valt en bij wie het
opgevraagd kan worden. Hij geeft geen gedeeltelijk antwoord en hij omschrijft het
niet. *"De marge is gezond"* is ook een lek.

De MCP levert daarvoor het materiaal: bij elk antwoord staat welke veldpaden zijn
weggelaten en om welke reden — paden en categorieën, nooit waarden.

## Wat er nog niet af is

De matrix in Toegang is **lezen, niet bewerken**. Instellen gebeurt vandaag in
`aios_role_grants`. Een editor komt pas als de vorm zich bij een tweede module
bewezen heeft; wie de categorieën bij een nieuwe klant toewijst is nog een open
besluit uit de bouwbriefing.

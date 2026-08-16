# Rechten — wie mag wat zien en goedkeuren

Eén rechtenmodel, geen tweede ernaast. De rol die bepaalt wat iemand mag
**goedkeuren** in de werkbak is dezelfde rol die bepaalt wat hij mag **zien**.

Wat erbij komt: een rol mag dat niet meer overal in gelijke mate.

## Drie lagen, van drie partijen

Toegang is de **doorsnede**. Elke laag kan alleen beperken, nooit verruimen.

| Laag | Wie zet het | Waar |
| --- | --- | --- |
| **Afname** — welke afdelingen heeft deze klant gekocht | Wij, bij het deployen | `LICENSED_MODULES` (var op de cockpit-Worker) |
| **Toewijzing** — wie binnen die afname doet wat | De beheerder bij de klant | `allowed_emails.modules` |
| **Rol** — hoe diep die persoon mag kijken | De beheerder bij de klant | `aios_role_grants` |

`'*'` betekent **nooit** "alles wat bestaat". Voor een klant is het "alles wat wij
hebben afgenomen", voor een gebruiker "alles wat mijn organisatie heeft". Een
beheerder bij de klant is een tenant-beheerder, geen super admin — die laatste
bestaat alleen aan onze kant, bij het zetten van de afname.

De afname staat daarom in de Worker-config en niet in de klant-database: die
database leeft in het Supabase-project van de klant, en een plafond dat de
begrensde partij zelf kan verzetten is geen plafond.

## Waarom afdeling en rang los blijven

| As | Wat het beslist | Waarom |
| --- | --- | --- |
| **module** | Of je in dit proces mag werken | Een salesmedewerker hoort geen administratie-item goed te keuren, ook niet als hij `reviewer` is |
| **categorie** | Hoe diep je binnen dat proces mag kijken | Een medewerker ziet de orderstatus, niet de marge |

De rollen blijven `admin | reviewer | viewer` uit `allowed_emails` — er komt geen
tweede gebruikerstabel bij.

Afdelingen zijn bewust géén rollen. Dat zou per afdeling drie rollen opleveren
(`klantenservice_medewerker`, `_teamleider`, `_kijker`) en elke nieuwe afdeling
vermenigvuldigt die lijst. Bovendien doet bij een kleinere klant dezelfde persoon
klantenservice én administratie; met afdelingen-als-rol wordt dat een tweede
account.

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
| `ui/app/api/admin/allowed-emails/[email]/route.ts` | Weigert een afdeling toewijzen die niet is afgenomen — server-side, want een scherm dat alleen het juiste tóónt is geen beveiliging |
| `ui/app/api/admin/invite/route.ts` | Zelfde plafond bij het uitnodigen |

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

## Afgenomen maar nog niet gebouwd

Registratie en afname zijn twee dingen: registratie zegt dat er code voor een
module bestaat, afname dat deze klant hem mag gebruiken. Een afdeling die wél is
afgenomen maar nog geen module heeft, is gewoon toewijsbaar aan een gebruiker —
er is alleen nog geen scherm. Zo kun je iemand alvast op HR zetten voordat de
HR-automatisering er is.

## Wat er nog niet af is

De **rolmatrix** in Toegang is lezen, niet bewerken; de rijen zelf staan in
`aios_role_grants`. De **afdelingen per gebruiker** zijn wél te bewerken, in
diezelfde Toegang-pagina.

De afname staat als Worker-var. Zolang wij deployen is dat een echt plafond;
deployt een klant ooit zelf, dan is het een contractuele afspraak en geen
technische grens — dan hoort hij naar het control plane.

# Fundament-uitbreiding: van mailagent naar bedrijfsbreed systeem

Onderzoek en bouwplan voor `Sjaakmatt/mail-agent-fundament`, augustus 2026.
Alle code wordt in Claude Code gemaakt. Deze map bevat het plan en de opdrachten.

## Leesvolgorde

| Bestand | Wat | Voor wie |
| --- | --- | --- |
| `00-architectuur-en-plan.md` | De vijf breuklijnen in het huidige fundament, het doelmodel (modulepakket), de triggerlaag, de feitenlaag, kosten, regressie en de fasering in 9 stappen | Lees dit eerst, helemaal |
| `claude-code-opdrachten.md` | Per fase één opdracht om letterlijk in Claude Code te plakken, met acceptatiecriteria | Bij het bouwen |
| `domein-catalogus.md` | 29 kandidaat-domeinen met prioritering, korte blauwdrukken voor prioriteit 2, en de eerlijke afvallers | Bij de vraag "wat bouwen we hierna" |
| `domein-administratie.md` | Volledige blauwdruk administratie en finance. Dit wordt module twee | Fase 5 |
| `domein-supplychain.md` | Volledige blauwdruk supply chain en operations | Fase 6 |
| `domein-sales.md` | Volledige blauwdruk sales | Fase 6 |
| `domein-marketing.md` | Volledige blauwdruk marketing | Fase 7 |
| `domein-hr.md` | Volledige blauwdruk HR en recruitment | Fase 7 |

## De kern in vijf zinnen

Het fundament is verder dan het lijkt: de work-bus, de actie-poort, het
rechtenmodel en de per-klant scaffolding zijn al generiek. Wat ontbreekt is dat
domeinkennis (gate, taxonomie, specialisten, feitenbronnen, actietypen) globaal
staat in plaats van per module, waardoor een tweede domein alleen via een fork
kan bestaan. De oplossing is één contract: een module is geen tab maar een
pakket dat de kern uitleest. Daarnaast moet de triggerlaag erbij, want
administratie, supply chain en sales beginnen zelden bij een mail, terwijl de
hele lus vandaag met een mail begint. De toets op het ontwerp is fase 5: kan
administratie erbij zonder één kernbestand te bewerken, dan klopt het.

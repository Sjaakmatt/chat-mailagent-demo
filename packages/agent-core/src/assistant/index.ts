/**
 * De werkbak-assistent, laag 1 — het dossier.
 *
 * Een raadpleegvenster naast het werk: waarom stelt de agent dit voor, wat is
 * de geschiedenis van deze klant, welk beleid geldt hier, en is dit eerder
 * voorgekomen. Eén invoerveld, geen tweede.
 *
 * **De assistent voert niets uit en verstuurt niets.** Hij leest. Alles wat
 * naar buiten gaat, gaat via de bestaande knoppen — dat is niet een keuze van
 * deze module maar harde regel 1 van dit product, en er zit hier dan ook geen
 * enkele schrijfroute in.
 *
 * De regel die deze module afdwingt is de andere: **elke bewering is
 * herleidbaar naar een bron uit dezelfde vraag.** Numerical grounding, maar dan
 * op een antwoord aan een medewerker in plaats van aan een klant. Een assistent
 * die plausibel klinkt en het verzint, is erger dan geen assistent: hij wordt
 * geloofd.
 *
 * Deze module is pure logica — bronnen erin, gevalideerd antwoord eruit. Het
 * ophalen van de bronnen leeft in de cockpit (die kent de database en de rol),
 * het model-id in config (harde regel 7).
 */

export * from './sources.js';
export * from './prompt.js';
export * from './answer.js';
export * from './analyse-gate.js';

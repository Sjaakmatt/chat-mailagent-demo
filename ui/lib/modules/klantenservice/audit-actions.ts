/**
 * De actie-slugs van de ticket-auditbron.
 *
 * Apart bestand omdat ze op twee plekken nodig zijn — de bron zelf en de
 * moduleregistratie — en `klantenservice-audit.ts` de database-laag importeert.
 * Zo kan de module zijn acties noemen zonder die laag mee te trekken.
 *
 * Verandert een slug, dan verandert de betekenis van bestaande auditregels
 * niet met terugwerkende kracht: dit zijn labels op tijdstempels, niet op
 * opgeslagen events. Toch vaste namen, zodat een filter in een opgeslagen link
 * blijft werken.
 */

export const CREATED = "CREATED";
export const CLAIMED = "CLAIMED";
export const CLOSED = "CLOSED";

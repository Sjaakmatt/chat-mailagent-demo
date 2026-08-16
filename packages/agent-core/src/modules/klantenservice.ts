/**
 * De klantenservice-module: hoe de mailagent zich bij de werkbak aanmeldt.
 *
 * Dit is het enige bestand waarin de lus-kern zegt *wie hij is* tegenover de
 * schil. Alles wat de werkbak van deze automatisering weet, komt hier vandaan —
 * en dat is precies zoveel als een tweede module (sales, administratie) ook zou
 * leveren.
 *
 * De categorieën komen uit `taxonomy/`, want dat blijft het bestand dat je per
 * klant aanpast. Het verschil met vroeger is dat de cockpit ze nu via de module
 * krijgt en niet meer rechtstreeks importeert: de schil kent geen
 * klantenservice-categorieën, hij kent modules die categorieën hebben.
 */

import { CATEGORIES } from '../taxonomy/index.js';
import type { ModuleDescriptor } from './index.js';

export const KLANTENSERVICE_MODULE: ModuleDescriptor = {
  id: 'klantenservice',
  label: 'Klantenservice',
  description: 'Inkomende klantvragen via mail en chat, met een concept-antwoord.',
  // De vormen die de orchestrator voor dit proces produceert. `draft_reply` is
  // de chat-variant; beide zijn een concept dat een mens goedkeurt.
  kinds: ['draft_email', 'draft_reply'],
  categories: CATEGORIES.map((c) => ({ slug: c.slug, label: c.label })),
};

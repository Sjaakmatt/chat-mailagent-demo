/**
 * Hoe klantenservice zich bij de werkbak aanmeldt.
 *
 * De descriptor is de helft van het pakket die de **schil** leest: id, label,
 * de vormen die dit proces produceert, en de categorieën waarin het
 * classificeert. Meer weet de cockpit niet van deze automatisering, en dat is
 * precies zoveel als een tweede module ook levert.
 *
 * Los van `pack.ts` gehouden omdat de cockpit hem apart importeert. Zou hij in
 * het pakket zitten, dan trekt elke import van de descriptor ook de prompts en
 * de actietypen de browserbundel in.
 */

import { KLANTENSERVICE_TAXONOMY } from './taxonomy.js';
import type { ModuleDescriptor } from '../index.js';

export const KLANTENSERVICE_MODULE: ModuleDescriptor = {
  id: 'klantenservice',
  label: 'Klantenservice',
  description: 'Inkomende klantvragen via mail en chat, met een concept-antwoord.',
  // De vormen die de orchestrator voor dit proces produceert. `draft_reply` is
  // de chat-variant; beide zijn een concept dat een mens goedkeurt.
  kinds: ['draft_email', 'draft_reply'],
  categories: KLANTENSERVICE_TAXONOMY.map((c) => ({ slug: c.slug, label: c.label })),
};

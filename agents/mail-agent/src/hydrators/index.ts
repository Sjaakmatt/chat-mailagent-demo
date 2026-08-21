/**
 * De hydrator-registry — waar een signaal een envelop wordt.
 *
 * Eén registratie per domein. De kern kent geen enkel domein: hij krijgt een
 * envelop en werkt daarmee. Hier staat welke domeinen deze Worker aankan, en
 * dat is bewust een korte, leesbare lijst.
 *
 * Een domein toevoegen is een bestand ernaast plus een regel hieronder. Komt er
 * een signaal binnen van een domein dat hier niet staat, dan blijft het staan
 * met een leesbare reden — niet doen alsof het een mail is.
 */

import {
  hydratorFor,
  type DomainHydrator,
  type Signal,
  type SignalEnvelope,
} from '@factumai/agent-core';
import type { Env } from '../env.js';
import { mailHydrator } from './mail.js';
import { chatHydrator } from './chat.js';
import { scheduleHydrator } from './schedule.js';
import { documentHydrator } from './document.js';

/**
 * De hydrators van deze Worker.
 *
 * `env` erin omdat een hydrator met MCP's en Storage praat. Per aanroep
 * opgebouwd en niet als module-constante: een Worker-isolate kan meerdere
 * requests met verschillende bindings zien, en een constante zou de eerste
 * vasthouden.
 */
export function hydrators(env: Env): DomainHydrator[] {
  return [mailHydrator(env), chatHydrator, scheduleHydrator, documentHydrator(env)];
}

/**
 * Maakt een signaal klaar voor de lus: ophalen wat ontbreekt, en lezen als
 * envelop.
 *
 * Geeft het gehydrateerde signaal terug naast de envelop. Beide, want ze zijn
 * niet hetzelfde: het signaal gaat naar de stappen die hun eigen domein kennen
 * (de classify-prompt leest de gespreksgeschiedenis uit de payload), de envelop
 * naar de kern.
 *
 * Gooit bij een onbekend domein. Dat is een expliciete uitkomst en geen
 * scenario: de aanroeper hoort het signaal te laten staan met een reden, niet
 * het door de poort van een ander domein te duwen.
 */
export async function prepareSignal(
  env: Env,
  signal: Signal,
): Promise<{ signal: Signal; envelope: SignalEnvelope }> {
  const hydrator = hydratorFor(hydrators(env), signal.domain);
  if (!hydrator) {
    throw new Error(
      `geen hydrator voor domein "${signal.domain}" (signaal ${signal.id}). ` +
        `Voeg er een toe in agents/mail-agent/src/hydrators/.`,
    );
  }

  // Fail-soft: een hydrator die niet bij zijn bron kan, geeft het signaal
  // ongewijzigd terug. Gooit hij tóch, dan gaan we verder met wat we hebben —
  // een lege body levert een zichtbaar mager voorstel op, en dat is beter dan
  // een run die omvalt op een MCP die even niet antwoordt.
  let gehydrateerd = signal;
  if (hydrator.hydrate) {
    try {
      gehydrateerd = await hydrator.hydrate(signal);
    } catch (err) {
      console.warn(
        `[hydrate] ${signal.domain} hydrator faalde voor ${signal.id}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { signal: gehydrateerd, envelope: hydrator.toEnvelope(gehydrateerd) };
}

/**
 * Wanneer klantenservice iets automatisch mag, en wat "geïdentificeerd" hier
 * betekent.
 *
 * De vier uitkomsten, de degradatie van `systeem` naar `taak` en de regel dat
 * mail nooit zonder mens naar buiten gaat zijn generiek en staan in
 * `outcomes/`. Wat hier staat is wat per proces verschilt.
 */

import type { OutcomePolicy } from '../contract.js';
import { sourceEmailFrom } from './facts.js';
import type { Outcome } from '../../outcomes/index.js';

export const KLANTENSERVICE_OUTCOMES: OutcomePolicy = {
  identification: {
    /**
     * Mail: het afzenderadres volstaat. Het komt van het mailsysteem en niet
     * uit een formulierveld, en elk uitgaand antwoord gaat langs een mens — een
     * verkeerde match wordt daar gezien voordat er iets de deur uitgaat.
     */
    mail: { senderAddressSuffices: true, requiresOrderReference: false },
    /**
     * Chat: niet. De bezoeker is anoniem, typt zelf wat hij wil, en het
     * antwoord gaat direct naar buiten. Daar hoort de identificatiestap uit
     * bouwbriefing §4 (mailadres plus ordernummer) vóór.
     */
    chat: { senderAddressSuffices: false, requiresOrderReference: true },
  },

  /**
   * Leidt een uitkomst af uit de specialist en de geëxtraheerde velden, voor
   * het geval de router er zelf geen noemt (oude prompt, kapotte JSON).
   *
   * Bewust conservatief: alles waar een mens iets mee moet, wordt `taak`.
   * Alleen `simple_reply` mag `kennis` of `systeem` worden, en `systeem`
   * uitsluitend als er een ordernummer in het bericht stond — anders valt er
   * niets op te zoeken en is het een kennisvraag.
   */
  fallbackOutcome({ specialist, extracted }): Outcome {
    const orderRef = extracted?.orderNumber;
    const hasOrder = typeof orderRef === 'string' && orderRef.trim().length > 0;

    switch (specialist) {
      case 'simple_reply':
        return hasOrder ? 'systeem' : 'kennis';
      case 'escalate':
        // De router kon niet classificeren. Dat is precies `onbekend`:
        // doorvragen of overdragen, géén ticket.
        return 'onbekend';
      case 'order_change':
      case 'complaint':
      case 'technical':
      case 'gdpr':
        return 'taak';
      default:
        // Onbekende of ontbrekende specialist: naar een mens, niet gokken.
        return 'taak';
    }
  },

  /**
   * Het adres dat het bronsysteem bij de order teruggaf.
   *
   * Komt uit de bron die de order ophaalde, en staat daarom in `facts.ts`:
   * vervangt een klant de ordertabel door een ERP-MCP, dan verhuist dit veld
   * mee zonder dat de lus het merkt.
   */
  sourceEmail: sourceEmailFrom,
};

import { describe, it, expect } from 'vitest';
import {
  ACTION_STATUSES,
  applyActionEdits,
  canTransitionAction,
  checkFieldBacking,
  evaluateApproval,
  filterPrecondition,
  PRECONDITION_FIELDS,
  hasPhoto,
  identificationLevel,
  identificationSuffices,
  isExpired,
  isOpenAction,
  buildProposedActions,
  mayProposeAction,
  preconditionDrift,
  proposableActionTypes,
  requiredApproverRole,
  ungroundedFields,
  type ProposedAction,
} from './index.js';
// De actietypen zelf horen bij een module. Klantenservice is de startset waar
// elke klant van vertrekt, dus de poort-tests draaien erop.
import { KLANTENSERVICE_ACTIONS as ACTION_TYPES } from '../modules/klantenservice/actions.js';

const getActionType = (slug: string) => ACTION_TYPES.find((t) => t.slug === slug);

/**
 * De goedkeurpoort, met het actietype van het voorstel erbij gezocht.
 *
 * Zoals de productiecode het ook doet: de typen staan op het modulepakket, dus
 * de aanroeper zoekt ze op. Een voorstel met een type dat niemand meer kent,
 * levert `undefined` op — en dat hoort de poort te weigeren.
 */
const beoordeel = (
  input: Omit<Parameters<typeof evaluateApproval>[0], 'def'>,
) => evaluateApproval({ ...input, def: getActionType(input.action.type) });

const nu = new Date('2026-08-16T09:00:00.000Z');

function voorstel(over: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'act_1',
    organizationId: 'org-demo',
    type: 'werkticket_aanmaken',
    payload: { subject: 'Onderdeel nabestellen' },
    evidence: [{ field: 'subject', toolCallId: 'tc-1' }],
    precondition: {},
    impact: 'Er wordt een werkticket aangemaakt voor productie.',
    status: 'voorgesteld',
    runId: 'sig_1',
    idempotencyKey: 'act_1',
    createdAt: '2026-08-16T08:00:00.000Z',
    expiresAt: '2026-08-23T08:00:00.000Z',
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('statusmachine', () => {
  it('loopt de gelukkige route helemaal af', () => {
    expect(canTransitionAction('voorgesteld', 'goedgekeurd')).toBe(true);
    expect(canTransitionAction('goedgekeurd', 'uitgevoerd')).toBe(true);
  });

  it('laat een uitgevoerde actie nergens meer heen', () => {
    for (const naar of ACTION_STATUSES) {
      expect(canTransitionAction('uitgevoerd', naar)).toBe(false);
    }
  });

  // Hervalidatie leeft hier: goedkeuren, preconditie klopt niet meer, terug in
  // de wachtrij in plaats van uitvoeren.
  it('staat verlopen toe ná goedkeuren', () => {
    expect(canTransitionAction('goedgekeurd', 'verlopen')).toBe(true);
  });

  // Een netwerkfout tijdens uitvoeren mag geen voorstel definitief weggooien.
  it('laat een mislukte uitvoering opnieuw', () => {
    expect(canTransitionAction('mislukt', 'goedgekeurd')).toBe(true);
    expect(canTransitionAction('mislukt', 'uitgevoerd')).toBe(false);
  });

  it('kan niet van voorgesteld direct naar uitgevoerd', () => {
    expect(canTransitionAction('voorgesteld', 'uitgevoerd')).toBe(false);
  });

  it('weet wat er nog op een mens wacht', () => {
    expect(isOpenAction('voorgesteld')).toBe(true);
    expect(isOpenAction('mislukt')).toBe(true);
    expect(isOpenAction('uitgevoerd')).toBe(false);
    expect(isOpenAction('afgewezen')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('typeregistratie', () => {
  it('heeft unieke slugs', () => {
    const slugs = ACTION_TYPES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // Het type om de machinerie op te beproeven: tool bestaat, impact op de klant
  // is nul, beide kanalen mogen.
  it('begint met werkticket aanmaken', () => {
    expect(ACTION_TYPES[0].slug).toBe('werkticket_aanmaken');
    expect(ACTION_TYPES[0].channels).toEqual(['mail', 'chat']);
  });

  // Alles wat de klant of het geld raakt, mag niet uit een anoniem gesprek
  // ontstaan op basis van een ordernummer van de pakbon.
  it('laat geen enkel type met zwakke identificatie uit chat ontstaan, behalve het interne', () => {
    for (const t of ACTION_TYPES) {
      if (t.slug === 'werkticket_aanmaken') continue;
      if (t.channels.includes('chat')) {
        expect(t.requiredIdentification).toBe('bevestigd');
      }
    }
  });

  it('geeft elk type een vervaltermijn', () => {
    for (const t of ACTION_TYPES) expect(t.expiresAfterMinutes).toBeGreaterThan(0);
  });
});

describe('mayProposeAction', () => {
  it('laat een toegestaan type door', () => {
    const r = mayProposeAction({
      types: ACTION_TYPES,
      type: 'werkticket_aanmaken',
      channel: 'chat',
      identification: 'zwak',
    });
    expect(r.ok).toBe(true);
  });

  it('weigert een onbekend type', () => {
    const r = mayProposeAction({
      types: ACTION_TYPES,
      type: 'raket_lanceren',
      channel: 'mail',
      identification: 'bevestigd',
    });
    expect(r).toMatchObject({ ok: false });
  });

  // De kanaalinstelling geldt bovenop identificatie: een type dat op chat
  // uitstaat ontstaat daar niet, ook niet met een bevestigde bezoeker.
  it('weigert op een uitgeschakeld kanaal, ook bij de sterkste identificatie', () => {
    const r = mayProposeAction({
      types: ACTION_TYPES,
      type: 'adres_wijzigen',
      channel: 'chat',
      identification: 'bevestigd',
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain('chat');
  });

  it('weigert bij te zwakke identificatie', () => {
    const r = mayProposeAction({
      types: ACTION_TYPES,
      type: 'adres_wijzigen',
      channel: 'mail',
      identification: 'zwak',
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain('gematcht');
  });
});

describe('identificatieniveaus', () => {
  it('rangschikt van zwak naar bevestigd', () => {
    expect(identificationSuffices('bevestigd', 'gematcht')).toBe(true);
    expect(identificationSuffices('gematcht', 'gematcht')).toBe(true);
    expect(identificationSuffices('zwak', 'gematcht')).toBe(false);
    expect(identificationSuffices('gematcht', 'bevestigd')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('onderbouwing per veld', () => {
  it('vindt een ongedekt veld diep in de payload', () => {
    const missend = ungroundedFields(
      { orderNumber: 'DEMO-1', address: { street: 'Kade 1', city: 'Utrecht' } },
      [
        { field: 'orderNumber', toolCallId: 'tc-1' },
        { field: 'address.street', toolCallId: 'tc-2' },
      ],
    );
    expect(missend).toEqual(['address.city']);
  });

  it('kijkt in array-regels, want daar zitten de bedragen', () => {
    const missend = ungroundedFields({ lines: [{ amount: 340, description: 'Retour' }] }, [
      { field: 'lines.0.description', toolCallId: 'tc-1' },
    ]);
    expect(missend).toEqual(['lines.0.amount']);
  });

  it('is tevreden als alles gedekt is', () => {
    expect(ungroundedFields({ a: 1 }, [{ field: 'a', toolCallId: 'tc-1' }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('autorisatiegrens', () => {
  const credit = getActionType('creditnota_voorstellen')!;

  it('laat een bedrag onder de drempel bij de medewerker', () => {
    expect(requiredApproverRole(credit, { amount: 100 })).toBe('reviewer');
  });

  it('tilt een bedrag boven de drempel naar de beheerder', () => {
    expect(requiredApproverRole(credit, { amount: 340 })).toBe('admin');
  });

  it('laat een type zonder drempel met rust', () => {
    const ticket = getActionType('werkticket_aanmaken')!;
    expect(requiredApproverRole(ticket, { amount: 10_000 })).toBe('reviewer');
  });
});

// ---------------------------------------------------------------------------

describe('hervalidatie', () => {
  it('ziet een veranderde orderstatus', () => {
    const drift = preconditionDrift(
      { orderNumber: 'DEMO-1', status: 'pending' },
      { orderNumber: 'DEMO-1', status: 'shipped' },
    );
    expect(drift).toEqual([{ field: 'status', was: 'pending', nu: 'shipped' }]);
  });

  // Wat het bronsysteem er verder bij levert, is niet waarop het voorstel is
  // gebaseerd. Meevergelijken zou elk voorstel op ruis laten afketsen.
  it('negeert velden die niet in de preconditie stonden', () => {
    expect(preconditionDrift({ status: 'pending' }, { status: 'pending', updatedAt: 'x' })).toEqual(
      [],
    );
  });

  it('ziet een veld dat verdwenen is', () => {
    const drift = preconditionDrift({ status: 'pending' }, {});
    expect(drift).toEqual([{ field: 'status', was: 'pending', nu: undefined }]);
  });
});

describe('isExpired', () => {
  it('is verlopen op het moment zelf', () => {
    expect(isExpired({ expiresAt: '2026-08-16T09:00:00.000Z' }, nu)).toBe(true);
  });
  it('is nog geldig ervoor', () => {
    expect(isExpired({ expiresAt: '2026-08-16T09:00:01.000Z' }, nu)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('evaluateApproval — de poort vóór uitvoeren', () => {
  it('laat een schoon voorstel door', () => {
    const r = beoordeel({
      action: voorstel(),
      actueel: {},
      approverRole: 'reviewer',
      now: nu,
    });
    expect(r).toEqual({ ok: true });
  });

  // De kern van de hele wijziging: veranderd = niet uitvoeren, terug in de
  // wachtrij, met de afwijking zichtbaar.
  it('weigert en verloopt als de situatie is veranderd', () => {
    const r = beoordeel({
      action: voorstel({
        type: 'adres_wijzigen',
        precondition: { orderNumber: 'DEMO-1', status: 'pending' },
      }),
      actueel: { orderNumber: 'DEMO-1', status: 'shipped' },
      approverRole: 'reviewer',
      now: nu,
    });
    expect(r).toMatchObject({ ok: false, status: 'verlopen' });
    if (!r.ok) {
      expect(r.reason).toContain('status');
      expect(r.reason).toContain('shipped');
    }
  });

  it('weigert een voorstel dat over de datum is', () => {
    const r = beoordeel({
      action: voorstel({ expiresAt: '2026-08-16T08:59:00.000Z' }),
      actueel: {},
      approverRole: 'reviewer',
      now: nu,
    });
    expect(r).toMatchObject({ ok: false, status: 'verlopen' });
  });

  it('weigert een bedrag boven de drempel bij een medewerker', () => {
    const r = beoordeel({
      action: voorstel({ type: 'creditnota_voorstellen', payload: { amount: 340 } }),
      actueel: {},
      approverRole: 'reviewer',
      now: nu,
    });
    expect(r).toMatchObject({ ok: false, status: 'afgewezen' });
    if (!r.ok) expect(r.reason).toContain('beheerder');
  });

  it('laat datzelfde bedrag door bij een beheerder', () => {
    const r = beoordeel({
      action: voorstel({ type: 'creditnota_voorstellen', payload: { amount: 340 } }),
      actueel: {},
      approverRole: 'admin',
      now: nu,
    });
    expect(r).toEqual({ ok: true });
  });

  it('laat een viewer niets goedkeuren', () => {
    const r = beoordeel({
      action: voorstel(),
      actueel: {},
      approverRole: 'viewer',
      now: nu,
    });
    expect(r).toMatchObject({ ok: false });
  });

  it('keurt niets twee keer goed', () => {
    const r = beoordeel({
      action: voorstel({ status: 'uitgevoerd' }),
      actueel: {},
      approverRole: 'admin',
      now: nu,
    });
    expect(r).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------

describe('identificatieniveau afleiden', () => {
  it('is gematcht als het bronsysteem adres en order aan elkaar knoopt', () => {
    expect(
      identificationLevel({
        senderAddress: 'k.dekker@example.nl',
        orderReference: 'DEMO-1001',
        sourceEmail: 'k.dekker@example.nl',
      }),
    ).toBe('gematcht');
  });

  it('trekt zich niets aan van hoofdletters en spaties', () => {
    // Mailadressen komen uit headers en formuliervelden; daar zit rommel in.
    // Daarop een niveau laten zakken zou de agent laten struikelen over iets
    // wat niets met identiteit te maken heeft.
    expect(
      identificationLevel({
        senderAddress: '  K.Dekker@Example.NL ',
        orderReference: ' DEMO-1001 ',
        sourceEmail: 'k.dekker@example.nl',
      }),
    ).toBe('gematcht');
  });

  it('blijft zwak als alleen het ordernummer klopt', () => {
    // Een ordernummer is bezit van een papiertje: het staat op de pakbon, in
    // de bevestigingsmail en soms op het pakket zelf.
    expect(
      identificationLevel({ senderAddress: 'iemand@elders.nl', orderReference: 'DEMO-1001' }),
    ).toBe('zwak');
  });

  it('blijft zwak als het adres niet is dat van de order', () => {
    expect(
      identificationLevel({
        senderAddress: 'fraude@elders.nl',
        orderReference: 'DEMO-1001',
        sourceEmail: 'k.dekker@example.nl',
      }),
    ).toBe('zwak');
  });

  it('blijft zwak zonder ordernummer, ook met een adres uit de bron', () => {
    expect(
      identificationLevel({
        senderAddress: 'k.dekker@example.nl',
        sourceEmail: 'k.dekker@example.nl',
      }),
    ).toBe('zwak');
  });

  it('is bevestigd alleen als de klant dat actief deed', () => {
    expect(identificationLevel({ confirmed: true })).toBe('bevestigd');
  });
});

// ---------------------------------------------------------------------------

describe('buildProposedActions', () => {
  const basis = {
    channel: 'mail' as const,
    identification: 'gematcht' as const,
    organizationId: 'org-demo',
    runId: 'sig_1',
    reviewItemId: 'ri_1',
    now: nu,
    // Deze suite gaat over de andere poorten. De foto-eis heeft z'n eigen
    // beschrijving verderop; hier zou hij elke test laten afketsen op iets
    // wat de test niet onderzoekt.
    attachments: [{ name: 'schade.jpg', contentType: 'image/jpeg' }],
  };

  const creditnota = {
    type: 'creditnota_voorstellen',
    payload: { invoiceNumber: 'F-2026-0042', amount: 89.95 },
    evidence: [
      { field: 'invoiceNumber', toolCallId: 'tc-1' },
      { field: 'amount', toolCallId: 'tc-2' },
    ],
    precondition: { invoiceNumber: 'F-2026-0042', status: 'open' },
    impact: 'Creditnota van € 89,95 op factuur F-2026-0042.',
  };

  it('bouwt een geldig voorstel met vervaldatum uit de registratie', () => {
    const { actions, rejected } = buildProposedActions({
      types: ACTION_TYPES, ...basis, planned: [creditnota] });
    expect(rejected).toEqual([]);
    expect(actions).toHaveLength(1);
    expect(actions[0].status).toBe('voorgesteld');
    expect(actions[0].reviewItemId).toBe('ri_1');
    // 24 uur, uit ACTION_TYPES — niet uit iets wat het model meegaf.
    expect(actions[0].expiresAt).toBe('2026-08-17T09:00:00.000Z');
  });

  it('geeft dezelfde run dezelfde sleutels, zodat een herhaalde step niet dubbel voorstelt', () => {
    const eerste = buildProposedActions({
      types: ACTION_TYPES, ...basis, planned: [creditnota] });
    const tweede = buildProposedActions({
      types: ACTION_TYPES, ...basis, planned: [creditnota] });
    expect(tweede.actions[0].id).toBe(eerste.actions[0].id);
    expect(tweede.actions[0].idempotencyKey).toBe(eerste.actions[0].idempotencyKey);
  });

  it('weigert een payload-veld zonder dekking in plaats van het weg te laten', () => {
    // Het bedrag half doorlaten is niet een halve fout — het is dezelfde fout
    // met een geruststellender scherm eromheen.
    const { actions, rejected } = buildProposedActions({
      types: ACTION_TYPES,
      ...basis,
      planned: [{ ...creditnota, evidence: [{ field: 'invoiceNumber', toolCallId: 'tc-1' }] }],
    });
    expect(actions).toEqual([]);
    expect(rejected[0].reason).toContain('amount');
  });

  it('weigert een type dat op dit kanaal uitstaat, met de reden erbij', () => {
    const { actions, rejected } = buildProposedActions({
      types: ACTION_TYPES,
      ...basis,
      channel: 'chat',
      planned: [creditnota],
    });
    expect(actions).toEqual([]);
    expect(rejected[0].reason).toContain('chat');
  });

  it('weigert bij te zwakke identificatie', () => {
    const { actions, rejected } = buildProposedActions({
      types: ACTION_TYPES,
      ...basis,
      identification: 'zwak',
      planned: [creditnota],
    });
    expect(actions).toEqual([]);
    expect(rejected[0].reason).toContain('gematcht');
  });

  it('weigert een voorstel zonder impact-tekst', () => {
    const { actions, rejected } = buildProposedActions({
      types: ACTION_TYPES,
      ...basis,
      planned: [{ ...creditnota, impact: '   ' }],
    });
    expect(actions).toEqual([]);
    expect(rejected[0].reason).toContain('impact');
  });

  it('laat de goede door en houdt de slechte tegen in dezelfde run', () => {
    // Eén kapot voorstel mag de rest niet meeslepen: dan zou een agent die
    // vier dingen ziet en er één fout doet, helemaal niets meer opleveren.
    const { actions, rejected } = buildProposedActions({
      types: ACTION_TYPES,
      ...basis,
      planned: [creditnota, { ...creditnota, type: 'bestaat_niet' }],
    });
    expect(actions).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].type).toBe('bestaat_niet');
  });
});

// ---------------------------------------------------------------------------

describe('payloadvelden', () => {
  it('geeft elk type minstens één veld', () => {
    // Een type zonder velden levert een prompt op waarin het model zelf mag
    // verzinnen wat de payload is — en dat is precies wat de registratie moet
    // voorkomen.
    for (const t of ACTION_TYPES) {
      expect(t.payloadFields.length).toBeGreaterThan(0);
    }
  });

  it('geeft elk veld een label en een hint', () => {
    for (const t of ACTION_TYPES) {
      for (const v of t.payloadFields) {
        expect(v.label.trim().length).toBeGreaterThan(0);
        expect(v.hint.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('proposableActionTypes', () => {
  it('laat bij mail met gematcht en een foto de creditnota zien maar niet de retour', () => {
    const slugs = proposableActionTypes({
      types: ACTION_TYPES,
      channel: 'mail',
      identification: 'gematcht',
      attachments: [{ name: 'schade.jpg', contentType: 'image/jpeg' }],
    }).map((t) => t.slug);
    expect(slugs).toContain('creditnota_voorstellen');
    // Retour vraagt om bevestigd; die noemen zou het model een belofte aan de
    // klant laten schrijven voor iets dat daarna wordt geweigerd.
    expect(slugs).not.toContain('retour_aanmelden');
  });

  it('houdt bij chat alleen over wat daar mag', () => {
    const slugs = proposableActionTypes({
      types: ACTION_TYPES,
      channel: 'chat',
      identification: 'zwak',
    }).map((t) => t.slug);
    expect(slugs).toEqual(['werkticket_aanmaken']);
  });

  it('noemt de creditnota niet zonder foto, zodat het model die niet belooft', () => {
    // Een type noemen dat daarna wordt geweigerd is niet neutraal: het model
    // schrijft er meestal een antwoord bij waarin het de klant dat bedrag
    // toezegt. Dan staat er een belofte die niemand nakomt.
    const slugs = proposableActionTypes({
      types: ACTION_TYPES, channel: 'mail', identification: 'gematcht' }).map(
      (t) => t.slug,
    );
    expect(slugs).not.toContain('creditnota_voorstellen');
  });

  it('is een hulpmiddel voor de prompt, geen vervanging van de poort', () => {
    // Wat hier niet in staat, moet alsnog stuklopen op buildProposedActions.
    const uit = buildProposedActions({
      types: ACTION_TYPES,
      planned: [
        {
          type: 'creditnota_voorstellen',
          payload: { invoiceNumber: 'F-1', amount: 10 },
          evidence: [
            { field: 'invoiceNumber', toolCallId: 'tc' },
            { field: 'amount', toolCallId: 'tc' },
          ],
          precondition: {},
          impact: 'Creditnota.',
        },
      ],
      channel: 'chat',
      identification: 'zwak',
      organizationId: 'org-demo',
      runId: 'sig_1',
      now: nu,
    });
    expect(uit.actions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('dekking per veldherkomst', () => {
  const velden = [
    { name: 'amount', label: 'Bedrag', hint: '', source: 'bron' as const },
    { name: 'reason', label: 'Reden', hint: '', source: 'bericht' as const },
  ];

  it('accepteert een bronveld met een tool-call en een berichtveld zonder iets', () => {
    // Het berichtveld hoeft niets te bewijzen: er is precies één bericht in een
    // run, dus een verwijzing ernaar voegt geen informatie toe.
    expect(
      checkFieldBacking({ amount: 89.95, reason: 'beschadigd' }, [
        { field: 'amount', toolCallId: 'db.invoice' },
      ], velden),
    ).toEqual([]);
  });

  it('weigert een bedrag dat alleen op het bericht leunt', () => {
    // Dit is het geval waarvoor harde regel 4 bestaat: een bedrag dat de klant
    // noemt is geen bedrag dat op de factuur staat.
    const uit = checkFieldBacking({ amount: 500 }, [{ field: 'amount', messageId: 'msg-1' }], velden);
    expect(uit).toHaveLength(1);
    expect(uit[0].reason).toContain('tool-call');
  });

  it('laat een reden door zonder enige onderbouwing, want die staat in geen systeem', () => {
    expect(checkFieldBacking({ reason: 'kwam kapot aan' }, [], velden)).toEqual([]);
  });

  it('weigert een veld waarvoor helemaal niets is meegegeven', () => {
    const uit = checkFieldBacking({ amount: 10 }, [], velden);
    expect(uit[0].reason).toContain('geen tool-call');
  });

  it('behandelt een niet-gedeclareerd veld als bron', () => {
    // Een vergeten declaratie mag de eis niet stilzwijgend versoepelen — dat is
    // het soort gat waar je pas achterkomt als er iets verkeerds is geboekt.
    const uit = checkFieldBacking({ onbekend: 'x' }, [{ field: 'onbekend', messageId: 'm' }], velden);
    expect(uit).toHaveLength(1);
    expect(uit[0].reason).toContain('tool-call');
  });

  it('laat een werkticket ontstaan uit puur de klantmail', () => {
    // Precies het geval dat vóór deze splitsing onmogelijk was: het type dat
    // bedoeld is om de machinerie op te beproeven, ketste af op zijn eigen
    // omschrijving.
    const { actions, rejected } = buildProposedActions({
      types: ACTION_TYPES,
      planned: [
        {
          type: 'werkticket_aanmaken',
          payload: { subject: 'Beschadigd artikel', description: 'Doos ingedrukt' },
          // Geen evidence: beide velden komen uit de mail.
          evidence: [],
          precondition: {},
          impact: 'Er wordt een werkticket aangemaakt.',
        },
      ],
      channel: 'mail',
      identification: 'zwak',
      organizationId: 'org-demo',
      runId: 'sig_1',
      now: nu,
    });
    expect(rejected).toEqual([]);
    expect(actions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('preconditie beperken tot wat toetsbaar is', () => {
  it('gooit een sleutel weg die geen enkele lookup teruggeeft', () => {
    // Dit ging fout op de demo: het model bedacht `phase`. Bij goedkeuring
    // vergelijkt preconditionDrift dat met undefined, ziet een verschil, en zet
    // het voorstel op verlopen — elke keer, zonder dat er iets veranderd is.
    expect(
      filterPrecondition('orderstatus', { status: 'pending', phase: 'Wacht op aftrap' }),
    ).toEqual({ status: 'pending' });
  });

  it('laat een lege preconditie leeg bij soort geen', () => {
    expect(filterPrecondition('geen', { status: 'x' })).toEqual({});
  });

  it('filtert het voorstel al bij het bouwen, niet pas bij goedkeuren', () => {
    const { actions } = buildProposedActions({
      types: ACTION_TYPES,
      planned: [
        {
          type: 'adres_wijzigen',
          payload: { orderNumber: 'DEMO-1003' },
          evidence: [{ field: 'orderNumber', toolCallId: 'db.order' }],
          precondition: { status: 'pending', phase: 'verzonnen' },
          impact: 'Adres wijzigen.',
        },
      ],
      channel: 'mail',
      identification: 'gematcht',
      organizationId: 'org-demo',
      runId: 'sig_1',
      now: nu,
    });
    expect(actions[0].precondition).toEqual({ status: 'pending' });
  });

  it('houdt de lijst gelijk met wat de lookups teruggeven', () => {
    // Loopt deze lijst achter, dan verdwijnt een controle stilzwijgend; loopt
    // hij voor, dan ketst elk voorstel af. Beide zijn stil, dus vastleggen.
    expect(PRECONDITION_FIELDS.orderstatus).toEqual(['orderNumber', 'status', 'trackingCode']);
    expect(PRECONDITION_FIELDS.factuurstatus).toEqual(['invoiceNumber', 'status', 'totalValue']);
  });
});

// ---------------------------------------------------------------------------

describe('geen defect goedkeuren zonder foto', () => {
  const creditnota = {
    type: 'creditnota_voorstellen',
    payload: { invoiceNumber: 'F-42', amount: 89.95 },
    evidence: [
      { field: 'invoiceNumber', toolCallId: 'db.invoice' },
      { field: 'amount', toolCallId: 'db.invoice' },
    ],
    precondition: { status: 'open' },
    impact: 'Creditnota van € 89,95.',
  };
  const basis = {
    planned: [creditnota],
    types: ACTION_TYPES,
    channel: 'mail' as const,
    identification: 'gematcht' as const,
    organizationId: 'org-demo',
    runId: 'sig_1',
    now: nu,
  };

  it('weigert een creditnota als de klant niets heeft meegestuurd', () => {
    const { actions, rejected } = buildProposedActions(basis);
    expect(actions).toEqual([]);
    expect(rejected[0].reason).toContain('foto');
  });

  it('laat het voorstel door met een foto erbij', () => {
    const { actions, rejected } = buildProposedActions({
      ...basis,
      attachments: [{ name: 'schade.jpg', contentType: 'image/jpeg' }],
    });
    expect(rejected).toEqual([]);
    expect(actions).toHaveLength(1);
  });

  it('accepteert een foto die als octet-stream binnenkomt', () => {
    // Genoeg mailclients doen dit. Een terechte claim mag niet afketsen op een
    // header die de klant niet in de hand heeft.
    expect(hasPhoto([{ name: 'IMG_4821.HEIC', contentType: 'application/octet-stream' }])).toBe(
      true,
    );
  });

  it('telt een pdf niet mee', () => {
    // Meestal een factuur of pakbon: nuttig, maar geen bewijs van schade.
    expect(hasPhoto([{ name: 'factuur.pdf', contentType: 'application/pdf' }])).toBe(false);
  });

  it('raakt typen zonder foto-eis niet', () => {
    const { actions } = buildProposedActions({
      types: ACTION_TYPES,
      ...basis,
      planned: [
        {
          type: 'werkticket_aanmaken',
          payload: { subject: 'Klacht' },
          evidence: [],
          precondition: {},
          impact: 'Werkticket.',
        },
      ],
      identification: 'zwak',
    });
    expect(actions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('een voorstel corrigeren', () => {
  const creditnota = getActionType('creditnota_voorstellen')!;

  it('past een bedrag aan en houdt het een getal', () => {
    // Uit een formulierveld komt tekst binnen. Zou dat een string blijven, dan
    // schrijft de uitvoerder straks "45" in een numerieke kolom.
    const uit = applyActionEdits(creditnota, { invoiceNumber: 'F-1', amount: 89 }, {
      amount: '45',
    });
    expect(uit.ok).toBe(true);
    if (uit.ok) expect(uit.payload.amount).toBe(45);
  });

  it('accepteert een komma als decimaalteken', () => {
    const uit = applyActionEdits(creditnota, { amount: 89 }, { amount: '44,50' });
    expect(uit.ok).toBe(true);
    if (uit.ok) expect(uit.payload.amount).toBe(44.5);
  });

  it('weigert het factuurnummer, want dat is een andere actie', () => {
    const uit = applyActionEdits(creditnota, { invoiceNumber: 'F-1', amount: 89 }, {
      invoiceNumber: 'F-999',
    });
    expect(uit.ok).toBe(false);
    if (!uit.ok) expect(uit.reason).toContain('niet te wijzigen');
  });

  it('weigert een onbekend veld in plaats van het te negeren', () => {
    // Stilzwijgend laten vallen zou betekenen dat iemand "opgeslagen" ziet en er
    // iets anders wordt uitgevoerd dan hij dacht.
    const uit = applyActionEdits(creditnota, { amount: 89 }, { stiekem: 'x' });
    expect(uit.ok).toBe(false);
  });

  it('weigert nul en negatief', () => {
    expect(applyActionEdits(creditnota, { amount: 89 }, { amount: '0' }).ok).toBe(false);
    expect(applyActionEdits(creditnota, { amount: 89 }, { amount: '-10' }).ok).toBe(false);
  });

  it('weigert een leeg tekstveld', () => {
    expect(applyActionEdits(creditnota, { reason: 'schade' }, { reason: '  ' }).ok).toBe(false);
  });

  it('kan een genest adresveld bijstellen', () => {
    const adres = getActionType('adres_wijzigen')!;
    const uit = applyActionEdits(
      adres,
      { orderNumber: 'DEMO-1', address: { street: 'Oud 1', city: 'Amsterdam' } },
      { 'address.street': 'Nieuw 44' },
    );
    expect(uit.ok).toBe(true);
    if (uit.ok) {
      expect((uit.payload.address as Record<string, unknown>).street).toBe('Nieuw 44');
      // De rest van het adres blijft staan; een correctie is geen vervanging.
      expect((uit.payload.address as Record<string, unknown>).city).toBe('Amsterdam');
    }
  });

  it('raakt het origineel niet aan', () => {
    const origineel = { amount: 89 };
    applyActionEdits(creditnota, origineel, { amount: '45' });
    expect(origineel.amount).toBe(89);
  });

  it('tilt een correctie boven de drempel naar de beheerder', () => {
    // Wie 89 naar 400 bijstelt, mag het niet ineens zelf mogen aftekenen.
    const uit = applyActionEdits(creditnota, { amount: 89 }, { amount: '400' });
    expect(uit.ok).toBe(true);
    if (uit.ok) expect(requiredApproverRole(creditnota, uit.payload)).toBe('admin');
  });
});

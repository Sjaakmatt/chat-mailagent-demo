import { describe, it, expect } from 'vitest';
import {
  ACTION_STATUSES,
  ACTION_TYPES,
  canTransitionAction,
  evaluateApproval,
  getActionType,
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
      type: 'werkticket_aanmaken',
      channel: 'chat',
      identification: 'zwak',
    });
    expect(r.ok).toBe(true);
  });

  it('weigert een onbekend type', () => {
    const r = mayProposeAction({ type: 'raket_lanceren', channel: 'mail', identification: 'bevestigd' });
    expect(r).toMatchObject({ ok: false });
  });

  // De kanaalinstelling geldt bovenop identificatie: een type dat op chat
  // uitstaat ontstaat daar niet, ook niet met een bevestigde bezoeker.
  it('weigert op een uitgeschakeld kanaal, ook bij de sterkste identificatie', () => {
    const r = mayProposeAction({
      type: 'adres_wijzigen',
      channel: 'chat',
      identification: 'bevestigd',
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain('chat');
  });

  it('weigert bij te zwakke identificatie', () => {
    const r = mayProposeAction({
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
    const r = evaluateApproval({
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
    const r = evaluateApproval({
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
    const r = evaluateApproval({
      action: voorstel({ expiresAt: '2026-08-16T08:59:00.000Z' }),
      actueel: {},
      approverRole: 'reviewer',
      now: nu,
    });
    expect(r).toMatchObject({ ok: false, status: 'verlopen' });
  });

  it('weigert een bedrag boven de drempel bij een medewerker', () => {
    const r = evaluateApproval({
      action: voorstel({ type: 'creditnota_voorstellen', payload: { amount: 340 } }),
      actueel: {},
      approverRole: 'reviewer',
      now: nu,
    });
    expect(r).toMatchObject({ ok: false, status: 'afgewezen' });
    if (!r.ok) expect(r.reason).toContain('beheerder');
  });

  it('laat datzelfde bedrag door bij een beheerder', () => {
    const r = evaluateApproval({
      action: voorstel({ type: 'creditnota_voorstellen', payload: { amount: 340 } }),
      actueel: {},
      approverRole: 'admin',
      now: nu,
    });
    expect(r).toEqual({ ok: true });
  });

  it('laat een viewer niets goedkeuren', () => {
    const r = evaluateApproval({
      action: voorstel(),
      actueel: {},
      approverRole: 'viewer',
      now: nu,
    });
    expect(r).toMatchObject({ ok: false });
  });

  it('keurt niets twee keer goed', () => {
    const r = evaluateApproval({
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
    const { actions, rejected } = buildProposedActions({ ...basis, planned: [creditnota] });
    expect(rejected).toEqual([]);
    expect(actions).toHaveLength(1);
    expect(actions[0].status).toBe('voorgesteld');
    expect(actions[0].reviewItemId).toBe('ri_1');
    // 24 uur, uit ACTION_TYPES — niet uit iets wat het model meegaf.
    expect(actions[0].expiresAt).toBe('2026-08-17T09:00:00.000Z');
  });

  it('geeft dezelfde run dezelfde sleutels, zodat een herhaalde step niet dubbel voorstelt', () => {
    const eerste = buildProposedActions({ ...basis, planned: [creditnota] });
    const tweede = buildProposedActions({ ...basis, planned: [creditnota] });
    expect(tweede.actions[0].id).toBe(eerste.actions[0].id);
    expect(tweede.actions[0].idempotencyKey).toBe(eerste.actions[0].idempotencyKey);
  });

  it('weigert een payload-veld zonder dekking in plaats van het weg te laten', () => {
    // Het bedrag half doorlaten is niet een halve fout — het is dezelfde fout
    // met een geruststellender scherm eromheen.
    const { actions, rejected } = buildProposedActions({
      ...basis,
      planned: [{ ...creditnota, evidence: [{ field: 'invoiceNumber', toolCallId: 'tc-1' }] }],
    });
    expect(actions).toEqual([]);
    expect(rejected[0].reason).toContain('amount');
  });

  it('weigert een type dat op dit kanaal uitstaat, met de reden erbij', () => {
    const { actions, rejected } = buildProposedActions({
      ...basis,
      channel: 'chat',
      planned: [creditnota],
    });
    expect(actions).toEqual([]);
    expect(rejected[0].reason).toContain('chat');
  });

  it('weigert bij te zwakke identificatie', () => {
    const { actions, rejected } = buildProposedActions({
      ...basis,
      identification: 'zwak',
      planned: [creditnota],
    });
    expect(actions).toEqual([]);
    expect(rejected[0].reason).toContain('gematcht');
  });

  it('weigert een voorstel zonder impact-tekst', () => {
    const { actions, rejected } = buildProposedActions({
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
  it('laat bij mail met gematcht de creditnota zien maar niet de retour', () => {
    const slugs = proposableActionTypes({
      channel: 'mail',
      identification: 'gematcht',
    }).map((t) => t.slug);
    expect(slugs).toContain('creditnota_voorstellen');
    // Retour vraagt om bevestigd; die noemen zou het model een belofte aan de
    // klant laten schrijven voor iets dat daarna wordt geweigerd.
    expect(slugs).not.toContain('retour_aanmelden');
  });

  it('houdt bij chat alleen over wat daar mag', () => {
    const slugs = proposableActionTypes({
      channel: 'chat',
      identification: 'zwak',
    }).map((t) => t.slug);
    expect(slugs).toEqual(['werkticket_aanmaken']);
  });

  it('is een hulpmiddel voor de prompt, geen vervanging van de poort', () => {
    // Wat hier niet in staat, moet alsnog stuklopen op buildProposedActions.
    const uit = buildProposedActions({
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

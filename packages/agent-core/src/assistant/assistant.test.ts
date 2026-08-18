import { describe, expect, it } from 'vitest';
import {
  buildAssistantPrompt,
  finalizeAssistantAnswer,
  makeSource,
  normalizeHistory,
  normalizeQuestion,
  MAX_HISTORY_TURNS,
  parseAssistantAnswer,
  renderSources,
  truncateSource,
  type AssistantSource,
} from './index.js';

const SOURCES: AssistantSource[] = [
  {
    id: 'beslislog:run-1',
    kind: 'beslislog',
    label: 'Beslislog van deze run',
    text: 'Poort: open. Categorie: levertijd_status. Specialist: simple_reply. Zekerheid 0.82.',
  },
  {
    id: 'beleid:pol-12',
    kind: 'beleid',
    label: 'Beleidsregel "Levertijden"',
    text: 'Bij een vertraging binnen 5 werkdagen: bevestigen en niet compenseren.',
  },
];

const json = (obj: unknown) => JSON.stringify(obj);

describe('parseAssistantAnswer', () => {
  it('leest een antwoord met citaten', () => {
    const parsed = parseAssistantAnswer(
      json({
        answer: 'De agent koos simple_reply.',
        claims: [{ statement: 'De agent koos simple_reply', sourceId: 'beslislog:run-1' }],
        cannotAnswer: null,
      }),
    );
    expect(parsed?.answer).toBe('De agent koos simple_reply.');
    expect(parsed?.claims).toHaveLength(1);
  });

  it('leest door de ```-fences heen', () => {
    const parsed = parseAssistantAnswer(
      '```json\n' + json({ answer: 'Ja.', claims: [] }) + '\n```',
    );
    expect(parsed?.answer).toBe('Ja.');
  });

  it('geeft null bij onleesbare output', () => {
    expect(parseAssistantAnswer('sorry, geen idee')).toBeNull();
    expect(parseAssistantAnswer('{ kapot')).toBeNull();
  });

  it('geeft null als er noch antwoord noch weigering in staat', () => {
    expect(parseAssistantAnswer(json({ claims: [] }))).toBeNull();
  });

  it('gooit onvolledige citaten weg in plaats van ze half te vertrouwen', () => {
    const parsed = parseAssistantAnswer(
      json({
        answer: 'Iets.',
        claims: [
          { statement: 'geldig', sourceId: 'beleid:pol-12' },
          { statement: 'geen bron' },
          { sourceId: 'beleid:pol-12' },
          { statement: '  ', sourceId: 'beleid:pol-12' },
        ],
      }),
    );
    expect(parsed?.claims).toEqual([
      { statement: 'geldig', sourceId: 'beleid:pol-12' },
    ]);
  });
});

describe('finalizeAssistantAnswer — de gate van stap 3', () => {
  it('laat een volledig herleidbaar antwoord door', () => {
    const result = finalizeAssistantAnswer(
      {
        answer: 'De agent koos simple_reply met zekerheid 0.82.',
        claims: [
          { statement: 'zekerheid 0.82', sourceId: 'beslislog:run-1' },
        ],
      },
      SOURCES,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grounding[0]?.sourceLabel).toBe('Beslislog van deze run');
    expect(result.usedSources.map((s) => s.id)).toEqual(['beslislog:run-1']);
  });

  it('houdt een antwoord in dat een verzonnen bron citeert', () => {
    const result = finalizeAssistantAnswer(
      {
        answer: 'Volgens het beleid mag dat.',
        claims: [{ statement: 'mag dat', sourceId: 'beleid:bestaat-niet' }],
      },
      SOURCES,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('niet_herleidbaar');
    expect(result.detail.onbekendeBronnen).toEqual(['beleid:bestaat-niet']);
  });

  it('houdt een antwoord in met een getal dat in geen enkele bron staat', () => {
    const result = finalizeAssistantAnswer(
      { answer: 'De klant wacht al 11 werkdagen.', claims: [] },
      SOURCES,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail.ongedekteGetallen).toContain('11');
  });

  it('geeft het afgekeurde antwoord nooit alsnog mee', () => {
    const result = finalizeAssistantAnswer(
      { answer: 'De marge is 34 procent.', claims: [] },
      SOURCES,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result)).not.toContain('34 procent');
  });

  it('rekent een getal uit een niet-geciteerde bron wél als gedekt', () => {
    // Anders slaat de controle aan op correcte antwoorden, en een guardrail
    // die vals alarm geeft wordt genegeerd.
    const result = finalizeAssistantAnswer(
      { answer: 'Binnen 5 werkdagen hoeft er niet gecompenseerd te worden.', claims: [] },
      SOURCES,
    );
    expect(result.ok).toBe(true);
  });

  it('behandelt "ik weet het niet" als een goede uitkomst, niet als fout', () => {
    const result = finalizeAssistantAnswer(
      { answer: '', claims: [], cannotAnswer: 'Er staat geen leverdatum in het dossier.' },
      SOURCES,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('geen_bron');
    expect(result.message).toBe('Er staat geen leverdatum in het dossier.');
  });

  it('weigert bij onleesbare modeloutput', () => {
    const result = finalizeAssistantAnswer(null, SOURCES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('onleesbaar');
  });

  it('houdt in zodra er ook maar één bewering niet klopt', () => {
    // De gate is "zonder één bewering die niet uit een bron komt" — dus één
    // fout citaat naast drie goede is nog steeds inhouden.
    const result = finalizeAssistantAnswer(
      {
        answer: 'Categorie levertijd_status, zekerheid 0.82.',
        claims: [
          { statement: 'levertijd_status', sourceId: 'beslislog:run-1' },
          { statement: 'zekerheid 0.82', sourceId: 'beslislog:run-1' },
          { statement: 'geen compensatie', sourceId: 'beleid:verzonnen' },
        ],
      },
      SOURCES,
    );
    expect(result.ok).toBe(false);
  });
});

describe('bronnen', () => {
  it('kapt een lange bron af met een zichtbare melding', () => {
    const long = 'a'.repeat(5000);
    const out = truncateSource(long, 100);
    expect(out.length).toBeLessThan(300);
    expect(out).toContain('afgekapt');
  });

  it('laat een korte bron ongemoeid', () => {
    expect(truncateSource('kort', 100)).toBe('kort');
  });

  it('kapt af bij het bouwen, zodat niemand het kan vergeten', () => {
    const source = makeSource({
      id: 'x',
      kind: 'beleid',
      label: 'l',
      text: 'b'.repeat(9000),
    });
    expect(source.text).toContain('afgekapt');
  });

  it('zet de id in de rendering, want dat is wat het model moet citeren', () => {
    const rendered = renderSources(SOURCES);
    expect(rendered).toContain('id="beslislog:run-1"');
    expect(rendered).toContain('id="beleid:pol-12"');
  });

  it('meldt het als er niets is in plaats van een lege string te sturen', () => {
    expect(renderSources([])).toBe('(geen bronnen beschikbaar)');
  });
});

describe('prompt', () => {
  it('zet de klantnaam, de context, de bronnen en de vraag erin', () => {
    const messages = buildAssistantPrompt({
      question: 'Waarom stelt hij dit voor?',
      contextLabel: 'concept-antwoord op een klantmail',
      sources: SOURCES,
      clientName: 'Acme',
    });
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Acme');
    expect(messages[1]?.content).toContain('Waarom stelt hij dit voor?');
    expect(messages[1]?.content).toContain('beslislog:run-1');
  });

  it('verbiedt uitvoeren en rekenen in de systeeminstructie', () => {
    const [system] = buildAssistantPrompt({
      question: 'x',
      contextLabel: 'y',
      sources: [],
      clientName: 'Acme',
    });
    expect(system?.content).toContain('raadpleegvenster');
    expect(system?.content).toContain('rekenen doe je niet');
  });

  it("normaliseert de vraag en kapt hem af", () => {
    expect(normalizeQuestion('  hallo  ')).toBe('hallo');
    expect(normalizeQuestion('')).toBeNull();
    expect(normalizeQuestion('   ')).toBeNull();
    expect(normalizeQuestion(42)).toBeNull();
    expect(normalizeQuestion('x'.repeat(5000))?.length).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Het gesprek: vervolgvragen begrijpen zonder dat geschiedenis dekking wordt
// ---------------------------------------------------------------------------

describe('gespreksgeschiedenis', () => {
  const bron = makeSource({
    id: 'beleid:1',
    kind: 'beleid',
    label: 'Beleidsregel "Klacht"',
    text: 'Bij een klacht binnen 24 uur reageren.',
  });

  it('zet eerdere beurten in de prompt, gemarkeerd als geen bron', () => {
    const messages = buildAssistantPrompt({
      question: 'en hoe lang mag dat duren?',
      contextLabel: 'Klantenservice — geen voorstel geopend',
      sources: [bron],
      clientName: 'Testklant',
      history: [{ question: 'welk beleid geldt bij klachten?', answer: 'Binnen 24 uur reageren.' }],
    });

    const user = messages[1]!.content;
    expect(user).toContain('welk beleid geldt bij klachten?');
    expect(user).toContain('geen bron');
    // De bronnen staan ná het gesprek en vlak vóór de vraag: "de bronnen
    // hieronder" uit de systeemprompt moet letterlijk kloppen.
    expect(user.indexOf('EERDERE BEURTEN')).toBeLessThan(user.indexOf('BRONNEN:'));
    expect(user.indexOf('BRONNEN:')).toBeLessThan(user.indexOf('VRAAG VAN DE MEDEWERKER'));
  });

  it('laat de prompt ongemoeid als er geen geschiedenis is', () => {
    const messages = buildAssistantPrompt({
      question: 'wat staat er open?',
      contextLabel: 'Klantenservice — geen voorstel geopend',
      sources: [bron],
      clientName: 'Testklant',
    });
    expect(messages[1]!.content).not.toContain('EERDERE BEURTEN');
  });

  it('dekt niets: een getal uit een eerdere beurt zakt alsnog', () => {
    // Dit is de reden dat geschiedenis geen bron is. Zou een eerder antwoord
    // meetellen als dekking, dan kan een verzonnen getal zichzelf legitimeren
    // door één beurt te overleven.
    const antwoord = parseAssistantAnswer(
      JSON.stringify({
        answer: 'Er staan 47 klachten open.',
        claims: [{ statement: 'Er staan 47 klachten open.', sourceId: 'beleid:1' }],
        cannotAnswer: null,
      }),
    );
    const uit = finalizeAssistantAnswer(antwoord, [bron]);
    expect(uit.ok).toBe(false);
  });
});

describe('normalizeHistory', () => {
  it('houdt alleen volledige paren over', () => {
    expect(
      normalizeHistory([
        { question: 'a', answer: 'b' },
        { question: '  ', answer: 'b' },
        { question: 'c' },
        null,
        'nee',
      ]),
    ).toEqual([{ question: 'a', answer: 'b' }]);
  });

  it('begrenst de lengte van de draad', () => {
    const veel = Array.from({ length: 20 }, (_, i) => ({
      question: `v${i}`,
      answer: `a${i}`,
    }));
    const uit = normalizeHistory(veel);
    expect(uit).toHaveLength(MAX_HISTORY_TURNS);
    // De laatste beurten, niet de eerste: een vervolgvraag slaat terug op wat
    // er net is gezegd.
    expect(uit[uit.length - 1]!.question).toBe('v19');
  });

  it('geeft een lege draad terug bij onzin', () => {
    expect(normalizeHistory(undefined)).toEqual([]);
    expect(normalizeHistory('draad')).toEqual([]);
  });
});

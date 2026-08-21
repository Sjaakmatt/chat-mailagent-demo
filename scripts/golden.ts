/**
 * De golden set — het vangnet onder elke volgende verbouwing.
 *
 *   pnpm eval:golden
 *
 * ## Wat dit meet, en wat niet
 *
 * Niet het oordeel van het model. Dat meet `adversarial-gate.ts`, en daar is een
 * API-sleutel voor nodig. Dit script draait op een `FakeLlmClient`: elke regel in
 * `tests/golden/klantenservice.jsonl` draagt zowel het bericht als het antwoord
 * dat het model erop zou geven.
 *
 * Wat er dan overblijft is precies wat wél van ons is: de **mechaniek tussen dat
 * antwoord en de uitkomst**. Uit een categorie volgt een specialist
 * (`taxonomy/`), uit een specialist plus de geëxtraheerde velden volgt een
 * uitkomst (`outcomes/`), en een dichte poort maakt van een bericht
 * `buiten_domein` zonder dat de router nog draait (`orchestrate/runRoute`).
 * Die drie mappingen verhuizen in fase 1 naar `modules/klantenservice/`, en dat
 * hoort een verplaatsing te zijn en geen gedragswijziging.
 *
 * Slaat deze set om na een refactor, dan is er iets veranderd wat niet had mogen
 * veranderen. Slaat hij om na een bewuste wijziging in de taxonomie, dan werk je
 * de jsonl bij — dat is dan de bedoeling en het staat in de diff.
 *
 * De runner is deterministisch en heeft geen netwerk nodig, dus hij kan in CI.
 */

import { readFileSync } from 'node:fs';
import {
  FakeLlmClient,
  evaluateDomainGate,
  packById,
  runRoute,
  type Classification,
  type LlmCompleteInput,
  type OrchestrationSteps,
  type Signal,
} from '@factumai/agent-core';
// Uit de agent-Worker en niet nagebouwd: de parser is het stuk dat de mapping
// van categorie naar specialist en uitkomst uitvoert. Een kopie hier zou de
// echte doen wegvallen uit de dekking, en dat is precies het bestand dat je
// bewaakt wil hebben.
import { parseClassification } from '../agents/mail-agent/src/steps.js';

const SET = 'tests/golden/klantenservice.jsonl';

/**
 * Het pakket waarvan deze set het gedrag vastlegt.
 *
 * Uit de registry en niet rechtstreeks geïmporteerd: dan draait de set op de
 * module zoals hij daadwerkelijk geregistreerd staat, en valt het op als een
 * klant hem uit `client.manifest.yaml` haalt.
 */
const PACK = packById('klantenservice');
if (!PACK) {
  console.error(`De module "klantenservice" staat niet in de registry — geen set om te draaien.`);
  process.exit(2);
}

interface GoldenLine {
  id: string;
  naam: string;
  signal: { subject?: string; bodyText?: string; from?: string };
  llm: {
    gate: { inDomain: boolean; reason: string };
    classify?: Record<string, unknown>;
  };
  verwacht: {
    in_domain: boolean;
    category: string;
    specialist?: string;
    outcome?: string;
  };
}

/** Wat de lus feitelijk deed bij deze regel. */
interface Uitkomst {
  in_domain: boolean;
  category: string;
  specialist?: string;
  outcome?: string;
}

function leesSet(pad: string): GoldenLine[] {
  return readFileSync(pad, 'utf8')
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && !r.startsWith('//'))
    .map((r, i) => {
      try {
        return JSON.parse(r) as GoldenLine;
      } catch (err) {
        throw new Error(
          `${pad} regel ${i + 1} is geen geldige JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
}

function signalVan(line: GoldenLine): Signal {
  return {
    id: `sig_${line.id}`,
    organizationId: 'org_golden',
    domain: 'mail',
    type: 'mail.received',
    payload: { ...line.signal },
    status: 'NEW',
    receivedAt: '2026-01-01T09:00:00.000Z',
  };
}

/**
 * De stappen zoals de agent-Worker ze bouwt, maar met een vaste LLM.
 *
 * De poort en de parser zijn de échte functies uit agent-core en de Worker; wat
 * we vervangen is alleen de bron van de twee antwoorden. De prompts draaien dus
 * gewoon mee — daardoor valt het op als iemand de poort-prompt sloopt zodat de
 * respons niet meer geparsed kan worden.
 */
function stappenVoor(line: GoldenLine): OrchestrationSteps {
  const llm = new FakeLlmClient((input: LlmCompleteInput) => {
    // De poort en de classificatie draaien allebei op de classify-tier, dus de
    // tier alleen is niet genoeg om ze uit elkaar te houden. De poort-prompt is
    // de enige die om `inDomain` vraagt.
    const system = input.messages.find((m) => m.role === 'system')?.content ?? '';
    if (system.includes('"inDomain"')) return JSON.stringify(line.llm.gate);
    return JSON.stringify(line.llm.classify ?? {});
  });

  return {
    async gate(signal) {
      const payload = signal.payload as { subject?: string; bodyText?: string };
      return evaluateDomainGate(
        { subject: payload.subject, body: payload.bodyText ?? '' },
        llm,
        PACK.gate,
      );
    },
    async classify(signal) {
      const payload = signal.payload as { subject?: string; bodyText?: string; from?: string };
      const out = await llm.complete({
        tier: 'classify',
        messages: [
          { role: 'system', content: 'classificatie' },
          {
            role: 'user',
            content: `Onderwerp: ${payload.subject ?? ''}\nVan: ${payload.from ?? ''}\n\n${payload.bodyText ?? ''}`,
          },
        ],
      });
      return parseClassification(PACK, out);
    },
    // De golden set stopt na de router: alles daarna (resolve, plan, ground)
    // raakt MCP's en modellen, en dat is een andere meting.
    async resolve() {
      return {};
    },
    async plan() {
      throw new Error('plan hoort in de golden set niet aangeroepen te worden');
    },
  };
}

async function draai(line: GoldenLine): Promise<Uitkomst> {
  const classification: Classification = await runRoute(signalVan(line), {
    pack: PACK,
    steps: stappenVoor(line),
  });
  if (classification.outOfDomain) {
    return { in_domain: false, category: classification.category };
  }
  return {
    in_domain: true,
    category: classification.category,
    specialist: classification.specialist,
    outcome: classification.outcome,
  };
}

/** Eén veld dat afwijkt. Gestructureerd, zodat de tabel niet hoeft te parsen. */
interface Afwijking {
  veld: string;
  verwacht: string;
  kreeg: string;
}

/**
 * De velden die verschillen tussen verwacht en werkelijk.
 *
 * Een veld dat de regel niet noemt, wordt niet getoetst. Zo kan een regel
 * buiten het domein zich beperken tot `in_domain` en `category`: er is dan geen
 * specialist en geen uitkomst, en die afwezigheid is de uitkomst.
 */
function afwijkingen(verwacht: GoldenLine['verwacht'], echt: Uitkomst): Afwijking[] {
  const uit: Afwijking[] = [];
  const vergelijk = (veld: string, v: unknown, e: unknown) => {
    if (v === undefined) return;
    if (v !== e) uit.push({ veld, verwacht: String(v), kreeg: String(e) });
  };
  vergelijk('in_domain', verwacht.in_domain, echt.in_domain);
  vergelijk('category', verwacht.category, echt.category);
  vergelijk('specialist', verwacht.specialist, echt.specialist);
  vergelijk('outcome', verwacht.outcome, echt.outcome);
  return uit;
}

function kolom(waarde: string, breedte: number): string {
  return waarde.length > breedte
    ? `${waarde.slice(0, breedte - 1)}…`
    : waarde.padEnd(breedte);
}

async function main(): Promise<void> {
  const set = leesSet(SET);
  const gezakt: Array<{ line: GoldenLine; diff: Afwijking[] }> = [];

  for (const line of set) {
    let echt: Uitkomst;
    try {
      echt = await draai(line);
    } catch (err) {
      gezakt.push({
        line,
        diff: [
          {
            veld: 'run',
            verwacht: 'loopt door',
            kreeg: err instanceof Error ? err.message : String(err),
          },
        ],
      });
      continue;
    }
    const diff = afwijkingen(line.verwacht, echt);
    if (diff.length > 0) gezakt.push({ line, diff });
  }

  console.log(`Golden set: ${SET}`);
  console.log(`${set.length - gezakt.length}/${set.length} regels zoals verwacht.\n`);

  if (gezakt.length === 0) {
    console.log('GOLDEN SET GEHAALD.');
    return;
  }

  // Een tabel en geen stapel losse meldingen: bij een refactor die de mapping
  // verschuift zakken er tien tegelijk, en dan wil je in één blik zien of het
  // steeds dezelfde verschuiving is.
  console.log(
    `${kolom('id', 5)} ${kolom('geval', 34)} ${kolom('veld', 12)} ${kolom('verwacht', 16)} werkelijk`,
  );
  console.log('-'.repeat(96));
  for (const { line, diff } of gezakt) {
    for (const [i, af] of diff.entries()) {
      console.log(
        `${kolom(i === 0 ? line.id : '', 5)} ${kolom(i === 0 ? line.naam : '', 34)} ` +
          `${kolom(af.veld, 12)} ${kolom(af.verwacht, 16)} ${af.kreeg}`,
      );
    }
  }

  console.error(
    `\nGOLDEN SET NIET GEHAALD — ${gezakt.length} van de ${set.length} regels wijken af.`,
  );
  console.error(
    'Was dit een refactor? Dan is er gedrag veranderd dat gelijk had moeten blijven.',
  );
  console.error(
    `Was het een bewuste wijziging in taxonomy/, outcomes/ of de poort? Werk dan ${SET} bij.`,
  );
  process.exitCode = 1;
}

void main();

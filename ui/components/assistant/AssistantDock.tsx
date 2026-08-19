"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CijferKaart, type Aggregatie } from "./CijferKaart";
import { useAssistantSubject } from "./AssistantContext";

/**
 * De assistent in de werkbak: één venster, altijd bereikbaar, dat meepraat over
 * waar je naar kijkt.
 *
 * Hij stond eerst op het detailscherm van een werkitem. Dat was de verkeerde
 * plek: dan is hij er alleen als je al weet welk item je nodig hebt, en juist de
 * vragen dáárvoor — "welk beleid geldt bij creditnota's", "wat staat er open" —
 * kon je nergens kwijt. Nu hangt hij aan de schil en schuift het onderwerp mee:
 * sta je op een voorstel, dan gaat het over dat voorstel; sta je in de lijst,
 * dan over het proces.
 *
 * Drie dingen blijven zoals ze waren, want die zijn de reden dat dit venster te
 * vertrouwen is:
 *
 *   de bronnen  — onder elk antwoord staat wat hij heeft ingezien, met een link.
 *                 Weggeklapt maar mét de telling in de kop, zodat het antwoord
 *                 leesbaar blijft zonder de herkomst te verstoppen.
 *   de weigering — kan hij iets niet herleiden, dan komt er geen antwoord met
 *                 een randje eromheen maar de reden en de bronnenlijst.
 *   geen knoppen — hij voert niets uit. Er zit geen schrijfroute in deze laag.
 */

interface Bron {
  id: string;
  kind: string;
  label: string;
  href: string | null;
}

interface GroundingRef {
  statement: string;
  sourceId: string;
  sourceLabel: string;
}

type Antwoord =
  | {
      ok: true;
      answer: string;
      grounding: GroundingRef[];
      gebruikteBronnen: string[];
      bronnen: Bron[];
      aggregatie: Aggregatie | null;
    }
  | { ok: false; reason: string; message: string; bronnen: Bron[] };

/** Eén blok in de draad: wat de medewerker vroeg en wat eruit kwam. */
interface Beurt {
  question: string;
  /** Null zolang het antwoord onderweg is. */
  antwoord: Antwoord | null;
  /** Een fout in het transport — geen weigering van de assistent zelf. */
  error: string | null;
}

/**
 * Voorbeeldvragen. Ze doen meer dan tijd besparen: ze zetten de verwachting.
 *
 * Daarom zijn het allemaal vragen van een **medewerker over zijn eigen werk**,
 * en niet vragen die een klant zou stellen. "Wat kost de kennisbank" is een
 * klantvraag; die hoort de agent te beantwoorden in een concept, niet de
 * assistent aan een collega. Zou zo'n vraag hier als voorbeeld staan, dan
 * gebruikt iedereen dit venster als productencyclopedie en mist hij waar het
 * voor is: beslissen over wat er in de bak ligt.
 */
const ALGEMEEN = [
  "Hoeveel vragen kwamen er vandaag binnen?",
  "Welke vraag komt het vaakst terug?",
  "Hoeveel klachten hebben we deze maand?",
  "Bij hoeveel klanten speelt dit?",
];

/** En mét een voorstel open: over deze klant en deze zaak. */
const OVER_DIT = [
  "Hoe vaak heeft deze klant al gemaild?",
  "Waar gaat het bij hem meestal over?",
  "Waarom stelt hij dit voor?",
  "Is dit eerder voorgekomen?",
];

export function AssistantDock({ moduleId }: { moduleId: string }) {
  const subject = useAssistantSubject();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [draad, setDraad] = useState<Beurt[]>([]);
  const bodem = useRef<HTMLDivElement>(null);

  // Nieuw onderwerp is een nieuw gesprek. Doorpraten over voorstel B met de
  // beurten van voorstel A erboven levert antwoorden op die kloppen bij de
  // verkeerde zaak — en dat is het soort fout dat niemand opmerkt.
  useEffect(() => {
    setDraad([]);
  }, [subject?.reviewItemId]);

  useEffect(() => {
    bodem.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [draad, busy]);

  async function ask(vraag: string) {
    const trimmed = vraag.trim();
    if (!trimmed || busy) return;
    setQuestion("");
    setBusy(true);

    // De geschiedenis is wat er al staat, niet wat er nu bij komt. Alleen
    // geslaagde beurten: een weigering herhalen als context maakt de volgende
    // vraag niet begrijpelijker.
    const history = draad
      .filter((b) => b.antwoord?.ok)
      .map((b) => ({
        question: b.question,
        answer: (b.antwoord as { ok: true; answer: string }).answer,
      }));

    setDraad((d) => [...d, { question: trimmed, antwoord: null, error: null }]);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          history,
          moduleId,
          ...(subject ? { reviewItemId: subject.reviewItemId } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        vulAan(setDraad, {
          antwoord: null,
          error: body.error ?? "De assistent kon de vraag niet verwerken.",
        });
        return;
      }
      vulAan(setDraad, { antwoord: (await res.json()) as Antwoord, error: null });
    } catch {
      vulAan(setDraad, { antwoord: null, error: "Geen verbinding met de assistent." });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-brand-600 pl-3.5 pr-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand-900/20 hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
        aria-label="Assistent openen"
      >
        <MessageCircle className="w-4 h-4" aria-hidden="true" />
        Assistent
      </button>
    );
  }

  const voorbeelden = subject ? OVER_DIT : ALGEMEEN;

  return (
    <section
      className="fixed bottom-5 right-5 z-40 flex flex-col w-[min(24rem,calc(100vw-2.5rem))] h-[min(34rem,calc(100vh-6rem))] rounded-xl border border-brand-200 bg-white shadow-2xl shadow-brand-900/20 overflow-hidden"
      aria-label="Assistent"
    >
      <header className="flex items-center gap-2 px-4 py-3 border-b border-brand-100 bg-surface-muted">
        <Sparkles className="w-4 h-4 text-brand-500 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-ink leading-tight">Assistent</h2>
          {/* Wát hij nu voor zich heeft, staat er altijd bij. Zonder dat regeltje
              weet je bij "dat staat er niet" niet of hij het verkeerde dossier
              open had of dat het er echt niet staat. */}
          <p className="text-[11px] text-ink-subtle truncate">
            {subject ? subject.label : "de hele werkbak — leest mee, voert niets uit"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="p-1 rounded text-ink-subtle hover:text-ink hover:bg-brand-50"
          aria-label="Assistent sluiten"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {draad.length === 0 && (
          <p className="text-xs text-ink-muted leading-relaxed">
            Vraag wat je wilt weten over{" "}
            {subject ? "deze zaak en deze klant" : "het werk in deze bak"} —
            aantallen, patronen, wat er speelt. Elk antwoord komt met de bronnen
            erbij; kan hij iets niet herleiden, dan zegt hij dat.
          </p>
        )}

        {draad.map((beurt, i) => (
          <BeurtBlok key={i} beurt={beurt} />
        ))}

        {busy && (
          <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            zoekt het na…
          </p>
        )}
        <div ref={bodem} />
      </div>

      {draad.length === 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          {voorbeelden.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => void ask(v)}
              className="px-2.5 py-1 rounded-full text-[11px] text-ink-muted border border-brand-200 bg-white hover:border-brand-400 hover:text-ink transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="flex items-center gap-2 border-t border-brand-100 px-3 py-2.5"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={subject ? "Vraag iets over dit voorstel…" : "Stel een vraag…"}
          maxLength={1000}
          disabled={busy}
          className="flex-1 rounded-lg border border-brand-200 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:bg-surface-muted"
        />
        <button
          type="submit"
          disabled={busy || question.trim().length === 0}
          className="inline-flex items-center justify-center rounded-lg bg-brand-600 p-2 text-white hover:bg-brand-700 disabled:opacity-50 disabled:hover:bg-brand-600"
          aria-label="Vraag versturen"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

/** Vult de laatste (nog lege) beurt aan met wat er terugkwam. */
function vulAan(
  setDraad: React.Dispatch<React.SetStateAction<Beurt[]>>,
  patch: { antwoord: Antwoord | null; error: string | null },
): void {
  setDraad((d) =>
    d.map((b, i) => (i === d.length - 1 ? { ...b, ...patch } : b)),
  );
}

function BeurtBlok({ beurt }: { beurt: Beurt }) {
  return (
    <div className="space-y-2">
      <p className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-brand-600 px-3 py-1.5 text-sm text-white">
        {beurt.question}
      </p>

      {beurt.error && (
        <p className="text-sm text-alert-700 bg-alert-50 border border-alert-200 rounded px-3 py-2">
          {beurt.error}
        </p>
      )}

      {beurt.antwoord && !beurt.antwoord.ok && (
        <div className="flex items-start gap-2 text-sm text-ink border border-brand-100 bg-surface-muted rounded px-3 py-2">
          <AlertTriangle
            className="w-4 h-4 flex-shrink-0 mt-0.5 text-accent-500"
            aria-hidden="true"
          />
          <p>{beurt.antwoord.message}</p>
        </div>
      )}

      {beurt.antwoord?.ok && (
        <div>
          <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">
            {beurt.antwoord.answer}
          </p>

          {beurt.antwoord.aggregatie && (
            <CijferKaart aggregatie={beurt.antwoord.aggregatie} />
          )}
        </div>
      )}

      {/* De verantwoording, weggeklapt. Zie `Balkje` voor waarom het toch
          zichtbaar blijft dát er onderbouwing is. */}
      {beurt.antwoord?.ok && beurt.antwoord.grounding.length > 0 && (
        <Balkje titel="Onderbouwing" aantal={beurt.antwoord.grounding.length}>
          <ul className="space-y-1.5">
            {beurt.antwoord.grounding.map((g, i) => (
              <li key={`${g.sourceId}-${i}`} className="text-[11px] text-ink-muted">
                {g.statement}
                <span className="block text-ink-subtle">{g.sourceLabel}</span>
              </li>
            ))}
          </ul>
        </Balkje>
      )}

      {beurt.antwoord && beurt.antwoord.bronnen.length > 0 && (
        <Balkje titel="Ingezien" aantal={beurt.antwoord.bronnen.length}>
          <Bronnen
            bronnen={beurt.antwoord.bronnen}
            gebruikt={beurt.antwoord.ok ? beurt.antwoord.gebruikteBronnen : []}
          />
        </Balkje>
      )}
    </div>
  );
}

/**
 * Een inklapbaar balkje onder een antwoord.
 *
 * De citaten en de bronnenlijst stonden allebei open onder elk antwoord. Bij één
 * bron valt dat mee; bij negen bronnen en zes citaten verdwijnt het antwoord
 * boven een muur van herkomst, en dan leest niemand het meer — ook de herkomst
 * niet.
 *
 * Dichtgeklapt, maar met het **aantal in de kop**. Dat is het verschil dat
 * telt: je ziet zonder klikken dát er zes beweringen onderbouwd zijn en negen
 * bronnen zijn ingezien, en je klikt alleen als je wilt weten wélke. Een balkje
 * zonder telling zou hetzelfde verstoppen als helemaal weglaten.
 *
 * `<details>` en niet een eigen open/dicht-state: dan werkt toetsenbord,
 * schermlezer en zoeken-op-de-pagina zonder dat wij daar iets voor doen.
 */
function Balkje({
  titel,
  aantal,
  children,
}: {
  titel: string;
  aantal: number;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded border border-brand-100 bg-surface-muted">
      <summary className="flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer list-none text-[11px] text-ink-muted hover:text-ink select-none">
        <ChevronRight
          className="w-3 h-3 flex-shrink-0 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {titel}
        <span className="text-ink-subtle">({aantal})</span>
      </summary>
      <div className="px-2.5 pb-2.5 pt-0.5">{children}</div>
    </details>
  );
}

/**
 * Wat de assistent heeft ingezien. Standaard zichtbaar, niet uitklapbaar —
 * een medewerker die een getal doorgeeft aan een klant moet kunnen zien waar
 * het vandaan komt zonder ergens op te moeten klikken.
 */
function Bronnen({ bronnen, gebruikt }: { bronnen: Bron[]; gebruikt: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1">
        {bronnen.map((b) => {
          const used = gebruikt.includes(b.id);
          const inner = (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border",
                used
                  ? "text-brand-800 border-brand-300 bg-brand-50"
                  : "text-ink-subtle border-brand-100 bg-white",
              )}
              title={used ? "Gebruikt in dit antwoord" : "Ingezien, niet geciteerd"}
            >
              {b.label}
              {b.href && <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />}
            </span>
          );
          return (
            <li key={b.id}>{b.href ? <Link href={b.href}>{inner}</Link> : inner}</li>
          );
        })}
    </ul>
  );
}

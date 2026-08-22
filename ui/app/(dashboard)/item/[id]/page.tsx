/**
 * De detailweergave van één voorstel — welke module het ook is.
 *
 * ## Wat de schil hier doet, en wat niet
 *
 * De schil haalt de rij op, bepaalt uit welke module hij komt, toetst of deze
 * medewerker die module mag betreden, en rendert wat de module levert. Meer
 * niet. Wat er ín het scherm staat — een klantmail met een concept, een offerte
 * met regels, een werkbon met onderdelen — is van de module.
 *
 * Tot fase 4 was dit `/mail/[id]`, en dat scherm kende de vorm van een mail van
 * kop tot staart. Voor een tweede module was er dan maar één weg geweest: een
 * `if` erbij. Vandaar deze route en `DetailView` op het modulecontract.
 *
 * ## De guard staat ná de query, en dat moet
 *
 * Andere schermen weigeren vóór ze iets ophalen. Hier kan dat niet: welke
 * module dit item is, staat op de rij. Dus eerst ophalen, dan toetsen, en pas
 * daarna iets tonen. De rij zelf lekt niet — bij een weigering gaat de
 * medewerker naar de werkbak zonder ooit inhoud te zien.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { cockpitEnv, makeClient, getReviewItem } from "@/lib/db";
import { requireModulePage } from "@/lib/auth/access";
import { moduleForRow } from "@/lib/modules";

export const dynamic = "force-dynamic";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = safeDecode(rawId);

  let row;
  try {
    row = await getReviewItem(makeClient(cockpitEnv()), id);
  } catch {
    row = undefined;
  }
  if (!row) return <NietGevonden id={id} />;

  // Rang is niet genoeg: een reviewer in klantenservice hoort een
  // administratie-item niet te zien. Kent geen enkele module deze rij, dan is
  // er niets te tonen — geen terugval op de eerste de beste module, want dat is
  // precies hoe een item in de verkeerde afdeling belandt.
  const mod = moduleForRow(row);
  if (!mod) notFound();

  // Dezelfde guard als op elk ander modulescherm, alleen later: welke module
  // dit is, wisten we hierboven nog niet. Weigert hij, dan gooit hij een
  // redirect en komt er niets van de rij op het scherm.
  const user = await requireModulePage(mod.id);

  // `await` omdat een detailweergave zijn eigen aanvullingen ophaalt. Een
  // synchrone module werkt net zo goed: awaiten van iets dat geen belofte is,
  // levert de waarde zelf.
  return <>{await mod.DetailView({ row, user })}</>;
}

function NietGevonden({ id }: { id: string }) {
  return (
    <>
      <div className="bg-white border-b border-brand-100 px-4 sm:px-8 py-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-brand-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Terug naar werkbak
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="text-center max-w-md">
          <div className="w-14 h-14 rounded-full bg-alert-50 flex items-center justify-center mx-auto mb-3">
            <AlertTriangle className="w-7 h-7 text-alert-500" />
          </div>
          <h2 className="font-display text-lg font-semibold text-brand-700 mb-1">
            Voorstel niet gevonden
          </h2>
          <p className="text-ink-muted text-sm">
            Het item met id{" "}
            <code className="text-xs bg-surface-muted px-1 py-0.5 rounded">{id}</code>{" "}
            bestaat niet of is verwijderd.
          </p>
        </div>
      </div>
    </>
  );
}

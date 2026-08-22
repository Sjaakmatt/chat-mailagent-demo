"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X, Loader2, Save, Archive, MailX } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReviewFormProps {
  id: string;
  initialSubject: string;
  initialBody: string;
  /** Alleen bewerkbaar als het item nog PENDING is. */
  editable: boolean;
  /**
   * Beleid 'no_reply' — geen concept; bij approve wordt de mail alleen
   * opgeruimd in Outlook (label + verplaatsen). UI toont een banner en een
   * "Markeer afgehandeld"-knop i.p.v. de concept-velden.
   */
  noReply?: boolean;
  noReplyReason?: string | null;
}

type Pending = "approve" | "edit" | "reject" | "save" | null;

export function ReviewForm({
  id,
  initialSubject,
  initialBody,
  editable,
  noReply = false,
  noReplyReason = null,
}: ReviewFormProps) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  // Wat we het laatst hebben opgeslagen (server-side concept), zodat het
  // dirty-vlag de niet-opgeslagen wijzigingen reflecteert i.p.v. de originele
  // intake-versie.
  const [savedSubject, setSavedSubject] = useState(initialSubject);
  const [savedBody, setSavedBody] = useState(initialBody);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const dirty = subject !== savedSubject || body !== savedBody;

  async function saveDraft() {
    if (pending || !dirty) return;
    setPending("save");
    setError(null);
    setSavedNote(null);
    try {
      const res = await fetch(
        `/api/review/${encodeURIComponent(id)}/draft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, body }),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      setSavedSubject(subject);
      setSavedBody(body);
      setSavedNote("Concept opgeslagen");
      // De tijdlijn moet de nieuwe edit-rij tonen.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  async function submit(
    action: "approve" | "edit" | "reject",
    payload: Record<string, unknown>,
  ) {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      const res = await fetch(`/api/review/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(null);
    }
  }

  if (!editable) {
    return (
      <div className="bg-white rounded-xl border border-brand-100 shadow-soft p-6">
        <h3 className="font-display text-lg font-semibold text-brand-700 mb-4">
          Voorgesteld antwoord
        </h3>
        <Field label="Onderwerp">
          <p className="text-sm text-ink">{subject}</p>
        </Field>
        <Field label="Bericht">
          <pre className="whitespace-pre-wrap font-sans text-sm text-ink leading-relaxed">
            {body}
          </pre>
        </Field>
        <p className="mt-4 text-xs text-ink-subtle">
          Dit item is al besloten en kan niet meer worden bewerkt.
        </p>
      </div>
    );
  }

  // Beleid 'no_reply' — geen concept; reviewer bevestigt alleen dat de mail
  // opgeruimd mag worden (label + verplaatsen in Outlook). Mocht de reviewer
  // tóch willen antwoorden, dan kan dat via "Toch antwoord schrijven".
  if (noReply) {
    return (
      <div className="bg-white rounded-xl border border-brand-100 shadow-soft p-6">
        <h3 className="font-display text-lg font-semibold text-brand-700 mb-2 flex items-center gap-2">
          <MailX className="w-5 h-5 text-brand-500" />
          Geen reactie nodig
        </h3>
        <div className="rounded-lg bg-brand-50/60 border border-brand-100 px-3 py-2.5 text-sm text-ink-muted leading-relaxed mb-5">
          {noReplyReason ||
            'Het beleid voor deze categorie zegt: alleen opruimen, geen antwoord. ' +
              'Bij goedkeuring wordt de mail in Outlook gelabeld en verplaatst naar ' +
              '"Afgehandeld door agent" — er gaat geen reply uit.'}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-alert-200 bg-alert-50 px-3 py-2 text-sm text-alert-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => submit('approve', {})}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              'bg-brand-700 text-white hover:bg-brand-800',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {pending === 'approve' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Archive className="w-4 h-4" />
            )}
            Bevestig: alleen opruimen
          </button>

          <button
            type="button"
            disabled={pending !== null}
            onClick={() => submit('reject', { reason: 'no_reply geannuleerd' })}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              'border border-alert-300 text-alert-600 hover:bg-alert-50',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {pending === 'reject' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <X className="w-4 h-4" />
            )}
            Afwijzen
          </button>
        </div>
        <p className="mt-3 text-xs text-ink-subtle">
          Wil je tóch een antwoord schrijven? Pas het beleid voor deze
          categorie aan in <span className="font-mono">/policy</span>, of
          ververs de pagina na een herclassificatie.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-brand-100 shadow-soft p-6">
      <h3 className="font-display text-lg font-semibold text-brand-700 mb-4">
        Concept beoordelen
      </h3>

      <label className="block mb-4">
        <span className="text-xs font-medium text-ink-muted uppercase tracking-wide">
          Onderwerp
        </span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={cn(
            "mt-1 w-full rounded-md border border-brand-200 px-3 py-2 text-sm text-ink",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
          )}
        />
      </label>

      <label className="block mb-4">
        <span className="text-xs font-medium text-ink-muted uppercase tracking-wide">
          Bericht
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          className={cn(
            "mt-1 w-full rounded-md border border-brand-200 px-3 py-2 text-sm text-ink leading-relaxed font-sans",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
          )}
        />
      </label>

      <label className="block mb-5">
        <span className="text-xs font-medium text-ink-muted uppercase tracking-wide">
          Reden van afwijzing (optioneel)
        </span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Bijv. toon klopt niet, feiten onjuist…"
          className={cn(
            "mt-1 w-full rounded-md border border-brand-200 px-3 py-2 text-sm text-ink",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
          )}
        />
      </label>

      {error && (
        <div className="mb-4 rounded-md border border-alert-200 bg-alert-50 px-3 py-2 text-sm text-alert-700">
          {error}
        </div>
      )}

      {(dirty || savedNote) && (
        <div className="mb-3 flex items-center justify-between gap-3 text-xs">
          <span className={cn(dirty ? "text-accent-700" : "text-green-700")}>
            {dirty
              ? "Niet-opgeslagen wijzigingen"
              : savedNote ?? ""}
          </span>
          {dirty && (
            <button
              type="button"
              disabled={pending !== null}
              onClick={saveDraft}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium",
                "border border-brand-200 text-brand-700 hover:bg-brand-50",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {pending === "save" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Concept opslaan
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending !== null || dirty}
          title={dirty ? "Wijzigingen aanwezig — gebruik 'Bewerken & versturen'" : undefined}
          onClick={() => submit("approve", {})}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
            "bg-brand-700 text-white hover:bg-brand-800",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {pending === "approve" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          Goedkeuren &amp; versturen
        </button>

        <button
          type="button"
          disabled={pending !== null || !dirty}
          title={!dirty ? "Pas eerst iets aan om te bewerken" : undefined}
          onClick={() => submit("edit", { subject, body })}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
            "bg-accent-400 text-white hover:bg-accent-500",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {pending === "edit" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Pencil className="w-4 h-4" />
          )}
          Bewerken &amp; versturen
        </button>

        <button
          type="button"
          disabled={pending !== null}
          onClick={() => submit("reject", { reason })}
          className={cn(
            "inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
            "border border-alert-300 text-alert-600 hover:bg-alert-50",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {pending === "reject" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <X className="w-4 h-4" />
          )}
          Afwijzen
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="text-xs font-medium text-ink-muted uppercase tracking-wide mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

import { RotateCw } from "lucide-react";
import Link from "next/link";

interface TopBarProps {
  pendingCount: number;
}

/**
 * Kop van de werkbak. Server-rendered: "ververs" is een gewone link die de
 * Server Component opnieuw ophaalt (geen client-side fetch-loop zoals in de
 * oude Vercel-app).
 */
export function TopBar({ pendingCount }: TopBarProps) {
  return (
    <header className="bg-white border-b border-brand-100 px-8 py-5 flex items-center justify-between">
      <div>
        <h1 className="font-display text-xl font-semibold text-brand-700">
          Werkbak
        </h1>
        <p className="text-sm text-ink-muted mt-0.5">
          {pendingCount > 0
            ? `${pendingCount} concept${pendingCount === 1 ? "" : "en"} wacht${pendingCount === 1 ? "" : "en"} op review.`
            : "Geen concepten wachten op review."}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="p-2 text-ink-muted hover:text-brand-700 hover:bg-brand-50 rounded-md transition-colors"
          title="Ververs"
          aria-label="Ververs"
        >
          <RotateCw className="w-4 h-4" />
        </Link>
      </div>
    </header>
  );
}

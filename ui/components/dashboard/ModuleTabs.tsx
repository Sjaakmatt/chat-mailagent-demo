import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * De tabs boven de werkbak: één per proces, plus "Alles".
 *
 * Server-rendered links met een `?module=`-parameter in plaats van client-state.
 * Dat is geen luiheid: de werkbak is server-rendered tegen de database, dus een
 * tab is gewoon een andere query. Het levert deelbare URL's op ("kijk even naar
 * de administratie-bak") en het scheelt een hydratatiestap.
 *
 * Bij één geregistreerde module tekent de werkbak deze balk niet — tabs die
 * niets te kiezen geven, zijn ruis.
 */
export interface ModuleTab {
  id: string;
  label: string;
  icon: LucideIcon;
  count: number;
}

interface ModuleTabsProps {
  tabs: ModuleTab[];
  /** Null = de "Alles"-tab is actief. */
  active: string | null;
  totalCount: number;
}

export function ModuleTabs({ tabs, active, totalCount }: ModuleTabsProps) {
  return (
    <nav
      className="flex items-center gap-1 border-b border-brand-100 -mx-4 sm:-mx-6 px-4 sm:px-6 mb-4 overflow-x-auto"
      aria-label="Processen"
    >
      <Tab href="/" label="Alles" count={totalCount} active={active === null} />
      {tabs.map((tab) => (
        <Tab
          key={tab.id}
          href={`/?module=${encodeURIComponent(tab.id)}`}
          label={tab.label}
          icon={tab.icon}
          count={tab.count}
          active={active === tab.id}
        />
      ))}
    </nav>
  );
}

function Tab({
  href,
  label,
  icon: Icon,
  count,
  active,
}: {
  href: string;
  label: string;
  icon?: LucideIcon;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap",
        "border-b-2 -mb-px transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 rounded-t",
        active
          ? "border-brand-600 text-ink font-medium"
          : "border-transparent text-ink-muted hover:text-ink hover:border-brand-200",
      )}
    >
      {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />}
      {label}
      <span className="tabular-nums text-xs text-ink-subtle">{count}</span>
    </Link>
  );
}

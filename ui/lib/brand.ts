/**
 * Brand-config — de enige plek in de cockpit waar de klantnaam, het logo en de
 * navigatie staan. Bij een nieuwe klant pas je dit bestand aan plus de
 * kleurtokens in `app/globals.css`; verder niets.
 *
 * Kleuren staan bewust NIET hier maar in CSS-variabelen, zodat ze zonder
 * rebuild te wisselen zijn en Tailwind-classes (`bg-brand-700`) overal blijven
 * werken. Zie `app/globals.css` → `:root`.
 */

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  FileClock,
  Inbox,
  PlayCircle,
  Settings,
  ShieldCheck,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  adminOnly?: boolean;
}

export interface Brand {
  /** Klantnaam zoals getoond in de sidebar en de <title>. */
  name: string;
  /**
   * Optioneel gesplitst logo: het eerste deel krijgt de accentkleur, het tweede
   * de normale tekstkleur (bv. `{ accent: "Factum", rest: "AI" }`). Leeg =
   * gewoon `name` tonen.
   *
   * Alles wat dit toont loopt via `components/BrandMark.tsx`. Type de naam
   * nergens anders in: hij stond ooit los in drie auth-schermen en bleef daar
   * na een herbranding gewoon staan.
   */
  logo?: { accent: string; rest: string };
  /** Ondertitel onder het logo. */
  tagline: string;
  /** Regel onderaan de sidebar. */
  footer: string;
  /** Navigatie-items van de kern. */
  navItems: NavItem[];
  /**
   * Extra items van klant-eigen domeinmodules. Apart gehouden zodat een
   * fundament-update `navItems` kan vervangen zonder klantmaatwerk te raken.
   */
  extraNavItems: NavItem[];
}

/**
 * Kern-navigatie. Een verse klant-agent heeft precies deze schermen:
 * werkbak → tickets → gesprekken → feedback → analytics → auditlog → beleid →
 * toegang.
 */
// Alleen schermen van de schíl zelf. Tickets, Gesprekken en Feedback stonden
// hier ook, maar dat zijn klantenservice-schermen: ze horen bij de module
// (`ui/lib/modules/klantenservice.ts`, veld `navItems`). Zo verdwijnen ze
// vanzelf voor iemand die die afdeling niet heeft — hier zouden ze voor
// iedereen zichtbaar blijven.
const CORE_NAV: NavItem[] = [
  { href: "/", label: "Werkbak", icon: Inbox },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/audit", label: "Auditlog", icon: FileClock },
  { href: "/policy", label: "Beleid", icon: Settings, adminOnly: true },
  { href: "/admin", label: "Toegang", icon: ShieldCheck, adminOnly: true },
];

export const BRAND: Brand = {
  name: "FactumAI",
  tagline: "Mail Agent",
  footer: "Aangedreven door FactumAI",
  navItems: CORE_NAV,
  // Vul dit bij een klant met een domeinmodule, bv.:
  //   { href: "/magazijn", label: "Magazijn", icon: Package }
  extraNavItems: [],
};

/**
 * Demo-item. Wordt alleen toegevoegd als `DEMO_MODE=true` op de Worker staat —
 * de layout beslist dat, niet dit bestand.
 */
export const DEMO_NAV_ITEM: NavItem = {
  href: "/demo",
  label: "Demo",
  icon: PlayCircle,
  adminOnly: true,
};

/** Alle navigatie-items in weergavevolgorde: werkbak, domein, dan de rest. */
export function navItems(): NavItem[] {
  if (BRAND.extraNavItems.length === 0) return BRAND.navItems;
  const [first, ...rest] = BRAND.navItems;
  return [first, ...BRAND.extraNavItems, ...rest];
}

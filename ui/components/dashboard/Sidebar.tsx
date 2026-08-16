"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Mail,
  Menu,
  X,
  LogOut,
  KeyRound,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { BRAND, navItems, DEMO_NAV_ITEM } from "@/lib/brand";
import { BrandWordmark } from "@/components/BrandMark";

type Role = "admin" | "reviewer" | "viewer";

// Navigatie + merknaam komen uit één plek: `lib/brand.ts`.
const NAV_ITEMS = navItems();

export function Sidebar({
  userEmail,
  role,
  demoEnabled = false,
}: {
  userEmail?: string | null;
  role?: Role | null;
  /** Toont het Demo-item; alleen aan als DEMO_MODE op de Worker staat. */
  demoEnabled?: boolean;
}) {
  const items = demoEnabled ? [...NAV_ITEMS, DEMO_NAV_ITEM] : NAV_ITEMS;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Desktop-collapse: per browser bewaard zodat hij blijft staan bij refresh.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Collapse-state uit localStorage halen en bewaren.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("sidebar-collapsed");
      if (v === "1") setCollapsed(true);
    } catch {
      // localStorage niet beschikbaar (private mode, etc.) — negeren
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      } catch {
        // niets
      }
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Menu openen"
        aria-expanded={open}
        aria-controls="sidebar-nav"
        className={cn(
          "lg:hidden fixed top-3 left-3 z-40 inline-flex items-center justify-center rounded-lg",
          "w-11 h-11 bg-white border border-brand-100 shadow-soft text-brand-700",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
        )}
      >
        <Menu className="w-5 h-5" aria-hidden="true" />
      </button>

      {open && (
        <button
          type="button"
          aria-label="Menu sluiten"
          onClick={() => setOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-brand-900/40 backdrop-blur-sm"
        />
      )}

      <aside
        id="sidebar-nav"
        className={cn(
          "bg-brand-700 flex flex-col",
          // Mobiel: full-width overlay
          "w-64 min-h-screen",
          // Desktop: sticky tegen de viewport zodat hij niet meescrolt
          "fixed inset-y-0 left-0 z-50 transform transition-transform duration-200",
          "lg:sticky lg:top-0 lg:h-screen lg:min-h-0 lg:translate-x-0 lg:transform-none lg:flex-shrink-0",
          // Inklap-breedte op desktop
          collapsed ? "lg:w-16" : "lg:w-64",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Hoofdnavigatie"
      >
        <div
          className={cn(
            "border-b border-brand-600 flex items-start justify-between",
            collapsed ? "px-3 py-4" : "px-6 py-6",
          )}
        >
          {!collapsed && (
            <div>
              <BrandWordmark
                accentClass="text-accent-400"
                restClass="text-white"
                className="text-2xl"
              />
              <div className="text-xs text-brand-200 font-sans mt-1">
                {BRAND.tagline}
              </div>
            </div>
          )}
          {/* Mobiel sluiten */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Menu sluiten"
            className={cn(
              "lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-md",
              "text-brand-200 hover:text-white hover:bg-brand-600/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-700",
            )}
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
          {/* Desktop in/uitklappen */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Menu uitklappen" : "Menu inklappen"}
            title={collapsed ? "Menu uitklappen" : "Menu inklappen"}
            className={cn(
              "hidden lg:inline-flex items-center justify-center w-8 h-8 rounded-md mx-auto",
              "text-brand-200 hover:text-white hover:bg-brand-600/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-700",
            )}
          >
            {collapsed ? (
              <ChevronsRight className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ChevronsLeft className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <nav
          className={cn(
            "flex-1 py-4 space-y-1 overflow-y-auto",
            collapsed ? "px-2" : "px-3",
          )}
          aria-label="Pagina's"
        >
          {items.filter(
            (item) => !item.adminOnly || role === "admin",
          ).map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));

            if (item.disabled) {
              return (
                <span
                  key={item.href}
                  aria-disabled="true"
                  title={collapsed ? item.label : "Binnenkort beschikbaar"}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium",
                    "text-brand-300/60 cursor-not-allowed select-none",
                    collapsed && "justify-center px-2",
                  )}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {!collapsed && (
                    <>
                      {item.label}
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-brand-400">
                        binnenkort
                      </span>
                    </>
                  )}
                </span>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-600 text-white"
                    : "text-brand-200 hover:bg-brand-600/50 hover:text-white",
                  collapsed && "justify-center px-2",
                )}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>

        <div
          className={cn(
            "border-t border-brand-600 space-y-3",
            collapsed ? "px-2 py-3" : "px-4 py-4",
          )}
        >
          {userEmail && !collapsed && (
            <div className="px-2">
              <div className="text-[10px] font-medium text-brand-300 uppercase tracking-wide mb-0.5">
                Ingelogd als{role ? ` · ${role}` : ""}
              </div>
              <div className="text-xs text-white truncate" title={userEmail}>
                {userEmail}
              </div>
            </div>
          )}

          {userEmail && (
            <Link
              href="/account"
              title={collapsed ? `Wachtwoord wijzigen (${userEmail})` : undefined}
              className={cn(
                "w-full inline-flex items-center gap-2 py-2 rounded-md text-sm font-medium",
                "text-brand-200 hover:bg-brand-600/50 hover:text-white transition-colors",
                collapsed ? "justify-center px-2" : "px-2",
              )}
            >
              <KeyRound className="w-4 h-4" aria-hidden="true" />
              {!collapsed && "Wachtwoord wijzigen"}
            </Link>
          )}

          {userEmail && (
            <form
              action="/api/auth/sign-out"
              method="post"
              className={collapsed ? "" : "px-2"}
            >
              <button
                type="submit"
                title={collapsed ? "Uitloggen" : undefined}
                className={cn(
                  "w-full inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium",
                  "text-brand-200 hover:bg-brand-600/50 hover:text-white transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-700",
                  collapsed && "justify-center px-2",
                )}
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                {!collapsed && "Uitloggen"}
              </button>
            </form>
          )}

          {!collapsed && (
            <div className="px-2 flex items-center gap-2 text-xs text-brand-300">
              <Mail className="w-3 h-3" aria-hidden="true" />
              <span>{BRAND.footer}</span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

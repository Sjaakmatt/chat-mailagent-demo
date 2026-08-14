import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combineert clsx en tailwind-merge zodat latere classes eerdere overschrijven.
 * Standaard utility in moderne Tailwind projecten.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format een ISO timestamp naar een leesbare Nederlandse datum.
 */
export function formatDateNL(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Hoelang geleden, in menselijke taal.
 */
export function timeAgoNL(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "zojuist";
  if (diffMin < 60) return `${diffMin} min geleden`;
  if (diffHr < 24) return `${diffHr} uur geleden`;
  if (diffDay < 7) return `${diffDay} dag${diffDay > 1 ? "en" : ""} geleden`;
  return formatDateNL(iso);
}

/**
 * Truncate een string voor preview weergave.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "…";
}
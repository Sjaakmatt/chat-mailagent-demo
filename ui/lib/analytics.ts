import type { ReviewMetricRow } from "./db";

/**
 * Aggregaties over ReviewItems voor de analytics-pagina. Pure functies (geen
 * IO) zodat ze testbaar zijn; de page levert de rijen aan.
 *
 * Status-levenscyclus: PENDING → APPROVED/EDITED/REJECTED → EXECUTED. Een
 * verstuurd item heeft status EXECUTED (de approve/edit-herkomst is dan weg),
 * dus tellen we EXECUTED als een positieve beslissing.
 */
export interface Metrics {
  total: number;
  pending: number;
  approved: number;
  edited: number;
  rejected: number;
  executed: number;
  /** Positieve beslissingen: approved + edited + executed. */
  positive: number;
  /** Besliste items: positief + rejected. */
  decided: number;
  /** positive / decided (0..1) of null als er niets besliste is. */
  approvalRate: number | null;
  avgConfidence: number | null;
  /** Gem. minuten created → decided. */
  avgReviewMinutes: number | null;
  /** Gem. minuten decided → executed. */
  avgExecuteMinutes: number | null;
  byCategory: { category: string; count: number }[];
  byDay: { day: string; count: number }[];
}

function diffMinutes(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return (b - a) / 60000;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function computeMetrics(rows: ReviewMetricRow[]): Metrics {
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const pending = count("PENDING");
  const approved = count("APPROVED");
  const edited = count("EDITED");
  const rejected = count("REJECTED");
  const executed = count("EXECUTED");

  const positive = approved + edited + executed;
  const decided = positive + rejected;

  const confidences = rows
    .map((r) => r.confidence)
    .filter((c): c is number => typeof c === "number");

  const reviewMins = rows
    .map((r) => diffMinutes(r.created_at, r.decided_at))
    .filter((m): m is number => m !== null);
  const executeMins = rows
    .map((r) => diffMinutes(r.decided_at, r.executed_at))
    .filter((m): m is number => m !== null);

  const catMap = new Map<string, number>();
  for (const r of rows) {
    const c = r.category?.trim() || "onbekend";
    catMap.set(c, (catMap.get(c) ?? 0) + 1);
  }
  const byCategory = [...catMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const dayMap = new Map<string, number>();
  for (const r of rows) {
    const day = (r.created_at ?? "").slice(0, 10);
    if (!day) continue;
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  const byDay = [...dayMap.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-14);

  return {
    total: rows.length,
    pending,
    approved,
    edited,
    rejected,
    executed,
    positive,
    decided,
    approvalRate: decided > 0 ? positive / decided : null,
    avgConfidence: avg(confidences),
    avgReviewMinutes: avg(reviewMins),
    avgExecuteMinutes: avg(executeMins),
    byCategory,
    byDay,
  };
}

/** Mensvriendelijke duur uit minuten (bv. "3 min", "2,4 u", "1,2 d"). */
export function humanDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1).replace(".", ",")} u`;
  return `${(hours / 24).toFixed(1).replace(".", ",")} d`;
}

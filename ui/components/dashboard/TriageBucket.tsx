import type { ReviewCardViewModel } from "@/lib/review";
import { ReviewCard } from "./ReviewCard";
import { cn } from "@/lib/utils";

interface TriageBucketProps {
  title: string;
  description: string;
  color: "auto" | "review" | "escalate" | "pending";
  items: ReviewCardViewModel[];
  emptyMessage?: string;
  /** Compacte enkele-regel-kaarten (afgehandelde bakken). */
  compact?: boolean;
}

const ACCENT: Record<TriageBucketProps["color"], string> = {
  auto: "bg-green-500",
  review: "bg-accent-400",
  escalate: "bg-alert-500",
  pending: "bg-brand-300",
};

export function TriageBucket({
  title,
  description,
  color,
  items,
  emptyMessage = "Geen items in deze bak.",
  compact = false,
}: TriageBucketProps) {
  return (
    <section className="flex flex-col rounded-lg bg-white border border-brand-100 overflow-hidden">
      <div className="flex items-stretch border-b border-brand-100">
        <div className={cn("w-0.5 flex-shrink-0", ACCENT[color])} />
        <div className="flex-1 min-w-0 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <h3 className="font-medium text-ink text-sm truncate">{title}</h3>
            <span className="text-xs tabular-nums text-ink-muted">
              {items.length}
            </span>
          </div>
          <p className="text-xs text-ink-muted mt-0.5 truncate">{description}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-280px)]">
        {items.length === 0 ? (
          <div className="text-center py-8 px-4 text-sm text-ink-subtle">
            {emptyMessage}
          </div>
        ) : (
          <ul className="divide-y divide-brand-50">
            {items.map((item) => (
              <li key={item.id}>
                <ReviewCard item={item} compact={compact} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

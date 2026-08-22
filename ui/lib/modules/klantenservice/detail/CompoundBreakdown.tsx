import { Layers, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import type { CompoundTaskSummary } from "@/lib/review";
import { specialistLabel } from "@/lib/modules/klantenservice";
import { cn } from "@/lib/utils";

interface CompoundBreakdownProps {
  tasks: CompoundTaskSummary[];
  /** Welke intent bepaalde de eindtoon van het geweven antwoord. */
  precedenceIntent: string | null;
}

/**
 * Toont per compound-task welke specialist het schreef, met welke zekerheid
 * en status, plus welke intent de eindtoon van het samengestelde antwoord
 * bepaalde. Bewust compact — de reviewer bewerkt het geweven body direct
 * onder dit blok; dit is context, geen editor.
 */
export function CompoundBreakdown({ tasks, precedenceIntent }: CompoundBreakdownProps) {
  if (tasks.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-accent-100 shadow-soft">
      <div className="flex items-center gap-2 px-6 py-4 border-b border-accent-100">
        <Layers className="w-5 h-5 text-accent-600" />
        <h3 className="font-display text-lg font-semibold text-brand-700">
          Samengesteld uit {tasks.length} taken
        </h3>
        {precedenceIntent && (
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-accent-800 border border-accent-200 bg-accent-50">
            Toon volgt: {specialistLabel(precedenceIntent) ?? precedenceIntent}
          </span>
        )}
      </div>

      <ul className="divide-y divide-brand-50">
        {tasks.map((task) => (
          <TaskRow key={task.taskId} task={task} />
        ))}
      </ul>
    </div>
  );
}

function TaskRow({ task }: { task: CompoundTaskSummary }) {
  const label = specialistLabel(task.intent) ?? task.intent;
  const conf = Math.round(task.confidence * 100);
  return (
    <li className="px-6 py-3.5">
      <div className="flex items-start gap-3">
        <TaskStatusIcon status={task.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-brand-800 border border-brand-300 bg-brand-100"
              title={`Specialist: ${label}`}
            >
              {label}
            </span>
            <span className="text-xs text-ink-subtle tabular-nums">
              {conf}%
            </span>
          </div>
          <p className="mt-1 text-sm text-ink leading-relaxed">
            {task.summary}
          </p>
          {task.reason && (
            <p className="mt-1 text-xs text-accent-700 leading-snug">
              {task.reason}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function TaskStatusIcon({ status }: { status: CompoundTaskSummary["status"] }) {
  const config: Record<
    CompoundTaskSummary["status"],
    { icon: typeof CheckCircle2; className: string; label: string }
  > = {
    ok: { icon: CheckCircle2, className: "text-green-600", label: "OK" },
    needs_human: {
      icon: AlertCircle,
      className: "text-accent-600",
      label: "Menselijke check",
    },
    error: { icon: XCircle, className: "text-alert-600", label: "Fout" },
  };
  const { icon: Icon, className, label } = config[status];
  return (
    <Icon
      className={cn("w-4 h-4 flex-shrink-0 mt-0.5", className)}
      aria-label={label}
    />
  );
}

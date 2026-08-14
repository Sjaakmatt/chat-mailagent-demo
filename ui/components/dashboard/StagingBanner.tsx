import { FlaskConical } from "lucide-react";

interface StagingBannerProps {
  /** Optioneel — toon de test-tenant-org-id klein in de banner zodat de
   * super-admin ziet welke tenant geladen is. */
  organizationId?: string;
}

/**
 * Vaste warning-banner boven de cockpit-header als deze deployment een
 * staging-cockpit is (`COCKPIT_MODE === "staging"`). Doel: onmiskenbaar
 * signaal dat je NIET naar prod-data kijkt, dus dat wijzigingen alleen
 * de test-tenant raken.
 *
 * Kleur bewust warning-oranje (in plaats van de merkkleur) zodat 't
 * visueel afwijkt van de rest van de klant-UI.
 */
export function StagingBanner({ organizationId }: StagingBannerProps) {
  return (
    <div
      role="alert"
      className="bg-accent-100 border-b border-accent-300 text-accent-900 px-4 py-2 flex items-center gap-2 text-sm"
    >
      <FlaskConical className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold uppercase tracking-wide text-xs mr-2">
          Staging
        </span>
        <span>
          Deze cockpit toont test-tenant-data. Wijzigingen raken géén echte
          klant-mails. Test hier vrij door en gebruik de dashboard-flow om
          changes te promoten naar prod.
        </span>
      </div>
      {organizationId && (
        <code className="text-[10px] text-accent-800 bg-accent-50 px-1.5 py-0.5 rounded truncate max-w-[240px]">
          {organizationId}
        </code>
      )}
    </div>
  );
}

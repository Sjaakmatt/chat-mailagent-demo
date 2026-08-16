import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * Het woordmerk, één keer.
 *
 * ## Waarom dit een component is en geen stuk JSX per pagina
 *
 * Dit stond drie keer los in de auth-schermen, met de klantnaam er letterlijk
 * ingetypt en gesplitst over twee spans. Daardoor bleef er bij een nieuwe klant
 * een oude naam op precies het eerste scherm staan dat iemand ziet — en omdat
 * de naam over twee elementen verdeeld was, vond zoeken op die naam hem niet
 * eens. De sidebar deed het al goed via `BRAND`; die was de enige.
 *
 * Alles wat de naam toont, hoort dus hier langs te gaan. Kleuren komen van
 * buiten, want op de donkere sidebar gelden andere tokens dan op een lichte
 * kaart.
 */
export function BrandWordmark({
  accentClass,
  restClass,
  className,
}: {
  accentClass: string;
  restClass: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline gap-0 font-display font-bold", className)}>
      {BRAND.logo ? (
        <>
          <span className={cn("italic", accentClass)}>{BRAND.logo.accent}</span>
          <span className={restClass}>{BRAND.logo.rest}</span>
        </>
      ) : (
        <span className={restClass}>{BRAND.name}</span>
      )}
    </div>
  );
}

/**
 * De kop boven een auth-scherm: woordmerk plus wat dit is. Inloggen, wachtwoord
 * vergeten en account activeren delen 'm.
 *
 * "Cockpit" staat hier bewust hard: dat is hoe dit product heet, geen
 * klantnaam. De naam eromheen komt uit `BRAND`.
 */
export function BrandHeader() {
  return (
    <div className="text-center mb-8">
      <BrandWordmark
        accentClass="text-accent-500"
        restClass="text-brand-700"
        className="justify-center text-3xl mb-2"
      />
      <div className="text-sm text-ink-muted">Cockpit</div>
    </div>
  );
}

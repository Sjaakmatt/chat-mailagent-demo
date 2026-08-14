import type { CockpitEnv } from "../env";

/**
 * Demo-modus staat standaard **uit**. Alleen een expliciete `DEMO_MODE=true`
 * op de Worker zet 'm aan — zo kan een productie-cockpit nooit per ongeluk
 * synthetische mail in de echte werkbak schuiven.
 */
export function isDemoEnabled(env: Pick<CockpitEnv, "DEMO_MODE">): boolean {
  return env.DEMO_MODE === "true";
}

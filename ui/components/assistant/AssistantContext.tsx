"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Waar het gesprek met de assistent op dit moment over gaat.
 *
 * De assistent zit in de schil en niet op een detailscherm, dus hij moet zelf
 * kunnen weten waar de medewerker naar kijkt. Dat kán via de URL — `/mail/<id>`
 * verraadt genoeg — maar dan zit er kennis van de routes van een module in een
 * kernbestand van de cockpit, en dat is precies de regressie die `MODULES.md`
 * verbiedt.
 *
 * Dus andersom: het scherm meldt zich aan. Een pagina die een onderwerp heeft,
 * rendert `<AssistantSubject …>`, en dat onderwerp is weg zodra je wegnavigeert.
 * De schil kent alleen "er is een onderwerp of niet".
 */
export interface AssistantSubjectValue {
  /** Het ReviewItem waar dit scherm over gaat. */
  reviewItemId: string;
  /** Wat er in de kop van het venster komt te staan. */
  label: string;
}

interface Store {
  subject: AssistantSubjectValue | null;
  setSubject: (s: AssistantSubjectValue | null) => void;
}

const Ctx = createContext<Store>({ subject: null, setSubject: () => {} });

export function AssistantSubjectProvider({ children }: { children: ReactNode }) {
  const [subject, setSubject] = useState<AssistantSubjectValue | null>(null);
  const value = useMemo(() => ({ subject, setSubject }), [subject]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistantSubject(): AssistantSubjectValue | null {
  return useContext(Ctx).subject;
}

/**
 * Meldt het onderwerp van dit scherm aan bij de assistent.
 *
 * Rendert niets. Ruimt zichzelf op bij het verlaten van de pagina — anders
 * blijft de assistent vragen beantwoorden over een voorstel dat de medewerker
 * al drie schermen geleden heeft dichtgeklikt.
 */
export function AssistantSubject({
  reviewItemId,
  label,
}: AssistantSubjectValue): null {
  const { setSubject } = useContext(Ctx);
  useEffect(() => {
    setSubject({ reviewItemId, label });
    return () => setSubject(null);
  }, [reviewItemId, label, setSubject]);
  return null;
}

import type { DataCategory } from '../access/grants.js';
/**
 * Tenant-context + credential-store contract — gevendord in agent-core zodat de
 * AIOS-stack (agent + cockpit-UI) volledig zelfstandig draait, zonder dependency
 * op de MCP-laag (`@factumai/shared`). Bewust een kleine, stabiele kopie van het
 * fundament dat de MCP's delen; alleen wat agent-core nodig heeft.
 */

/** Identificeert de tenant + de lopende tool-call op elke DB/MCP-call. */
export interface TenantContext {
  organizationId: string;
  agentId: string;
  toolCallId: string;
  parentCallId?: string;
  /** Optionele instance/mailbox-selector (leeg = primaire instance). */
  instanceKey?: string;
  /**
   * De datacategorieën die deze aanroeper bij een MCP mag opvragen.
   *
   * Spiegel van hetzelfde veld in de MCP-laag (`@factumai/shared`). Laat je het
   * weg, dan snijdt de MCP zijn antwoord terug tot alleen `operationeel` en
   * verdwijnen velden stilzwijgend — zie `docs/RECHTEN.md`.
   */
  dataCategories?: DataCategory[];
}

export interface CredentialValue {
  systemType: string;
  value: Record<string, unknown>;
  expiresAt?: Date;
}

export interface ICredentialStore {
  lookup(ctx: TenantContext, systemType: string): Promise<CredentialValue>;
  update?(
    ctx: TenantContext,
    systemType: string,
    value: Record<string, unknown>,
  ): Promise<void>;
}

/**
 * Triviale credential-store die altijd dezelfde service-role-key teruggeeft,
 * ongeacht tenant — de AIOS-DB-toegang (review-items, signals, memory) draait
 * platform-breed op de klant-Supabase met één service-role-key.
 */
export class ServiceRoleCredentialStore implements ICredentialStore {
  constructor(private readonly serviceRoleKey: string) {
    if (!serviceRoleKey) {
      throw new Error('ServiceRoleCredentialStore vereist een niet-lege serviceRoleKey');
    }
  }

  async lookup(_ctx: TenantContext, systemType: string): Promise<CredentialValue> {
    return { systemType, value: { serviceRoleKey: this.serviceRoleKey } };
  }
}

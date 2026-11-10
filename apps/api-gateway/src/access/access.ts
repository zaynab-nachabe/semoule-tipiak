// Règle d'accès (docs/contrat-api.md §5) : rôle × relation active consentie. Fonctions pures.

import type { Role } from '@project/shared-types';

/** Ce que l'API sait de l'appelant pour décider de ses droits. */
export interface AccessContext {
  readonly personId: string;
  readonly role: Role;
  /** Pour un senior : son propre seniorId. */
  readonly ownSeniorId: string | null;
  /** Pour la famille et le médical : seniors liés par une relation consentie, non révoquée. */
  readonly grantedSeniorIds: readonly string[];
}

export interface RelationshipRecord {
  readonly seniorId: string;
  readonly relationType: Role;
  readonly consentStatus: 'PENDING' | 'GRANTED' | 'REVOKED';
  readonly revokedAt: Date | null;
}

/** Une relation n'ouvre l'accès que si elle est consentie, non révoquée et du même type que le rôle. */
export function grantedSeniorIds(role: Role, relationships: readonly RelationshipRecord[]): string[] {
  if (role === 'SENIOR') return [];
  return relationships
    .filter((r) => r.consentStatus === 'GRANTED' && r.revokedAt === null && r.relationType === role)
    .map((r) => r.seniorId);
}

/** Lien d'un aidant vers un senior, vu depuis le senior (pour trouver qui prévenir). */
export interface CaregiverLink extends RelationshipRecord {
  readonly caregiverId: string;
}

/**
 * Personnes à qui remettre une notification adressée à un rôle : même règle que l'accès aux données
 * (relation consentie, non révoquée, du type du rôle). Une famille sans consentement n'est pas prévenue.
 */
export function recipientIdsForRole(role: Role, links: readonly CaregiverLink[]): string[] {
  return links
    .filter((l) => l.relationType === role && l.consentStatus === 'GRANTED' && l.revokedAt === null)
    .map((l) => l.caregiverId);
}

export function accessibleSeniorIds(ctx: AccessContext): string[] {
  return ctx.role === 'SENIOR' ? (ctx.ownSeniorId ? [ctx.ownSeniorId] : []) : [...ctx.grantedSeniorIds];
}

export function canAccessSenior(ctx: AccessContext, seniorId: string): boolean {
  return accessibleSeniorIds(ctx).includes(seniorId);
}

/** Actions et données réservées à certains rôles (contrat §5). */
export const Capability = {
  READ_MEASUREMENTS: ['MEDICAL'],
  ACKNOWLEDGE_ALERT: ['MEDICAL'],
  CLOSE_ALERT: ['MEDICAL'],
  /** « Tout va bien » et « J'ai besoin d'aide » : le senior seulement, pour lui-même. */
  CANCEL_ALERT: ['SENIOR'],
  REQUEST_HELP: ['SENIOR'],
} as const satisfies Record<string, readonly Role[]>;

export function hasCapability(role: Role, capability: keyof typeof Capability): boolean {
  return (Capability[capability] as readonly Role[]).includes(role);
}

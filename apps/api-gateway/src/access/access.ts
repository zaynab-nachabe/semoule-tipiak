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
} as const satisfies Record<string, readonly Role[]>;

export function hasCapability(role: Role, capability: keyof typeof Capability): boolean {
  return (Capability[capability] as readonly Role[]).includes(role);
}

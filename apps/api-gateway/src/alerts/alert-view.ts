// Projection d'une alerte selon le rôle (docs/contrat-api.md §5) : une donnée non autorisée
// n'est pas cachée par le frontend, elle n'est pas envoyée (null).

import type { AlertView, Role } from '@project/shared-types';
import type { AlertRecord } from './alert-record';

export function toAlertView(alert: AlertRecord, role: Role): AlertView {
  return {
    alertId: alert.id,
    seniorId: alert.seniorId,
    status: alert.status,
    reason: alert.reason,
    severity: role === 'SENIOR' ? null : alert.severity,
    escalationCause: role === 'MEDICAL' ? alert.escalationCause : null,
    cancellationCause: alert.cancellationCause,
    createdAt: alert.createdAt.toISOString(),
    acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    closedAt: alert.closedAt?.toISOString() ?? null,
  };
}

/** Une alerte en cours : pas encore résolue (en levée de doute ou escaladée, non clôturée). */
export function isInProgress(alert: AlertRecord): boolean {
  return alert.status !== 'RESOLVED' && alert.resolvedAt === null;
}

/** L'alerte a atteint le niveau 2 ou plus (elle porte une gravité), qu'elle soit encore en cours ou clôturée. */
export function wasEscalated(alert: AlertRecord): boolean {
  return alert.severity !== null;
}

/**
 * Qui reçoit une alerte en temps réel. Le senior suit ses propres alertes (bandeau « tout va bien ? »).
 * La famille et le médical ne sont sollicités qu'à partir de l'escalade (niveau 2 et plus, ADR 0005),
 * puis suivent l'alerte jusqu'à sa clôture.
 */
export function isPushedTo(alert: AlertRecord, role: Role): boolean {
  return role === 'SENIOR' || wasEscalated(alert);
}

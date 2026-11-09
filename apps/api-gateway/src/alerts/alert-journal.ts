// Mise à jour du journal des alertes à partir des événements de domaine (fonction pure).
// Les événements arrivent sur des topics différents : leur ordre n'est pas garanti, et QoS 1 peut
// en livrer deux fois. Les transitions sont donc monotones : une alerte ne revient jamais en arrière
// (RESOLVED ou ESCALATED ne redeviennent pas PRE_CONFIRMING ; CRITICAL ne redescend pas en WARNING).

import type { DomainEvent, Severity } from '@project/shared-types';
import type { AlertRecord } from './alert-record';

export type JournalChange = 'created' | 'updated' | 'unchanged';

export interface JournalResult {
  readonly next: AlertRecord | null;
  readonly change: JournalChange;
}

const SEVERITY_RANK: Record<Severity, number> = { SYSTEM: 0, PRE_ALERT: 1, WARNING: 2, CRITICAL: 3 };

export function applyDomainEvent(current: AlertRecord | null, event: DomainEvent): JournalResult {
  switch (event.type) {
    case 'PreConfirmationRequested': {
      const p = event.payload;
      if (current) {
        return merged(current, { triggeringEventIds: union(current.triggeringEventIds, p.triggeringEventIds) });
      }
      return {
        change: 'created',
        next: {
          id: p.alertId,
          seniorId: event.seniorId,
          reason: p.reason,
          status: 'PRE_CONFIRMING',
          severity: null,
          escalationCause: null,
          cancellationCause: null,
          triggeringEventIds: [...p.triggeringEventIds],
          createdAt: new Date(p.requestedAt),
          acknowledgedAt: null,
          acknowledgedById: null,
          resolvedAt: null,
          closedAt: null,
          closedById: null,
        },
      };
    }

    case 'PreConfirmationCanceled': {
      // Sans l'événement de création (motif inconnu), rien à journaliser.
      if (!current || (current.status !== 'PENDING' && current.status !== 'PRE_CONFIRMING')) {
        return { next: current, change: 'unchanged' };
      }
      return merged(current, {
        status: 'RESOLVED',
        cancellationCause: event.payload.cause,
        resolvedAt: new Date(event.timestamp),
      });
    }

    case 'PreConfirmationTimeoutExpired':
      // L'escalade qui suit (CriticalAlertGenerated) porte l'information utile.
      return { next: current, change: 'unchanged' };

    case 'CriticalAlertGenerated': {
      const p = event.payload;
      if (!current) {
        return {
          change: 'created',
          next: {
            id: p.alertId,
            seniorId: event.seniorId,
            reason: p.reason,
            status: 'ESCALATED',
            severity: p.severity,
            escalationCause: p.escalationCause,
            cancellationCause: null,
            triggeringEventIds: [...p.triggeringEventIds],
            createdAt: new Date(event.timestamp),
            acknowledgedAt: null,
            acknowledgedById: null,
            resolvedAt: null,
            closedAt: null,
            closedById: null,
          },
        };
      }
      if (current.status === 'RESOLVED') {
        return { next: current, change: 'unchanged' };
      }
      const raises = current.severity === null || SEVERITY_RANK[p.severity] > SEVERITY_RANK[current.severity];
      return merged(current, {
        status: 'ESCALATED',
        ...(raises ? { severity: p.severity, escalationCause: p.escalationCause } : {}),
        triggeringEventIds: union(current.triggeringEventIds, p.triggeringEventIds),
      });
    }
  }
}

function merged(current: AlertRecord, patch: Partial<AlertRecord>): JournalResult {
  const next: AlertRecord = { ...current, ...patch };
  const changed = (Object.keys(patch) as (keyof AlertRecord)[]).some((k) => !same(current[k], next[k]));
  return changed ? { next, change: 'updated' } : { next: current, change: 'unchanged' };
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])];
}

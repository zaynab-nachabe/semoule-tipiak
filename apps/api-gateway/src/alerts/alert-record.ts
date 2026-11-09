// Forme d'une alerte du journal (table alerts), indépendante de Prisma pour garder la logique testable.

import type { AlertReason, AlertStatus, CancellationCause, EscalationCause, Severity } from '@project/shared-types';

export interface AlertRecord {
  id: string;
  seniorId: string;
  reason: AlertReason;
  status: AlertStatus;
  severity: Severity | null;
  escalationCause: EscalationCause | null;
  cancellationCause: CancellationCause | null;
  triggeringEventIds: string[];
  createdAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedById: string | null;
  resolvedAt: Date | null;
}

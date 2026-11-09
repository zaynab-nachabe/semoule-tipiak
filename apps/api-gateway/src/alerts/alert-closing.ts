// Prise en charge et clôture d'une alerte par l'équipe médicale (fonctions pures).

import type { AlertRecord } from './alert-record';

export type ClosingRefusal = 'ALREADY_RESOLVED' | 'NOT_ESCALATED';

export type ClosingResult =
  | { readonly ok: true; readonly next: AlertRecord; readonly changed: boolean }
  | { readonly ok: false; readonly refusal: ClosingRefusal };

/** Prise en charge : renseigne acknowledgedAt une seule fois. Une alerte résolue ne se prend plus en charge. */
export function acknowledgeAlert(alert: AlertRecord, personId: string, now: Date): ClosingResult {
  if (alert.status === 'RESOLVED') return { ok: false, refusal: 'ALREADY_RESOLVED' };
  if (alert.acknowledgedAt) return { ok: true, next: alert, changed: false };
  return { ok: true, next: { ...alert, acknowledgedAt: now, acknowledgedById: personId }, changed: true };
}

/**
 * Clôture après intervention. Seule une alerte escaladée (niveau 2 ou 3) se clôture ici : une levée de
 * doute en cours appartient à la détection (minuteurs en mémoire), qui la résout ou l'escalade elle-même.
 * Clôturer vaut prise en charge si elle n'avait pas été faite.
 */
export function closeAlert(alert: AlertRecord, personId: string, now: Date): ClosingResult {
  if (alert.status === 'RESOLVED') return { ok: false, refusal: 'ALREADY_RESOLVED' };
  if (alert.status !== 'ESCALATED') return { ok: false, refusal: 'NOT_ESCALATED' };
  return {
    ok: true,
    changed: true,
    next: {
      ...alert,
      status: 'RESOLVED',
      resolvedAt: now,
      closedAt: now,
      closedById: personId,
      acknowledgedAt: alert.acknowledgedAt ?? now,
      acknowledgedById: alert.acknowledgedById ?? personId,
    },
  };
}

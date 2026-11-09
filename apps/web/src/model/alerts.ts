// Logique d'affichage des alertes, sans React : testée dans test/alerts.test.ts.

import type { AlertView, NotificationView } from '@project/shared-types';

/** Ajoute ou remplace une alerte reçue en temps réel ; la liste reste triée de la plus récente à la plus ancienne. */
export function upsertAlert(alerts: readonly AlertView[], next: AlertView): AlertView[] {
  const others = alerts.filter((a) => a.alertId !== next.alertId);
  return [next, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Ajoute une notification reçue en temps réel, sans doublon. */
export function prependNotification(list: readonly NotificationView[], next: NotificationView): NotificationView[] {
  return [next, ...list.filter((n) => n.notificationId !== next.notificationId)];
}

/** Ce que le médical peut faire sur une alerte (mêmes règles que l'API : 409 sinon). */
export function medicalActions(alert: AlertView): { canAcknowledge: boolean; canClose: boolean } {
  const escalated = alert.status === 'ESCALATED' && alert.closedAt === null;
  return { canAcknowledge: escalated && alert.acknowledgedAt === null, canClose: escalated };
}

/** Secondes restantes avant la fin de la levée de doute (0 si dépassée). */
export function secondsLeft(expiresAt: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 1000));
}

/** Points d'une courbe, du plus ancien au plus récent (l'API les renvoie du plus récent au plus ancien). */
export function chronological<T extends { timestamp: string }>(points: readonly T[]): T[] {
  return [...points].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

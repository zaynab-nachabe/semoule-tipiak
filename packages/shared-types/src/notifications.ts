// Notifications publiées par le service de notification (docs/format-evenements.md §9).
// Une notification par rôle destinataire ; l'API la remet ensuite aux personnes de ce rôle.

import type { IsoUtcTimestamp, TopicSafeId, Uuid } from './common.js';
import type { AlertReason, EscalationCause, Severity } from './domain-events.js';

export const NotificationType = { NotificationRequested: 'NotificationRequested' } as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** Rôles qui reçoivent des notifications (le senior est sollicité par la levée de doute, pas par une notification). */
export const RecipientRole = { FAMILY: 'FAMILY', MEDICAL: 'MEDICAL' } as const;
export type RecipientRole = (typeof RecipientRole)[keyof typeof RecipientRole];

/** INFO : pour trace ; NORMAL : à traiter ; URGENT : à traiter immédiatement. */
export const NotificationPriority = { INFO: 'INFO', NORMAL: 'NORMAL', URGENT: 'URGENT' } as const;
export type NotificationPriority = (typeof NotificationPriority)[keyof typeof NotificationPriority];

export interface NotificationRequestedPayload {
  alertId: string;
  recipientRole: RecipientRole;
  priority: NotificationPriority;
  severity: Severity;
  reason: AlertReason;
  escalationCause: EscalationCause;
  /** Texte destiné aux personnes, en français. */
  title: string;
  message: string;
}

/** L'eventId identifie la notification (dédoublonnage côté API). */
export interface NotificationRequested {
  eventId: Uuid;
  seniorId: TopicSafeId;
  type: NotificationType;
  timestamp: IsoUtcTimestamp;
  payload: NotificationRequestedPayload;
}

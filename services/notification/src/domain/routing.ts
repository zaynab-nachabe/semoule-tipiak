// Règle de routage (docs/format-evenements.md §9, ADR 0008) : à partir d'une alerte avérée,
// quels rôles prévenir, avec quelle priorité et quel texte. Fonctions pures.

import type {
  AlertReason,
  CriticalAlertGeneratedPayload,
  EscalationCause,
  NotificationPriority,
  RecipientRole,
  Severity,
} from '@project/shared-types';

export interface RoutedNotification {
  readonly recipientRole: RecipientRole;
  readonly priority: NotificationPriority;
  readonly title: string;
  readonly message: string;
}

/** Niveau 2 : la famille agit, le médical est tenu informé. Niveau 3 : tout le monde, en urgence. */
const ROUTES: Partial<Record<Severity, readonly { recipientRole: RecipientRole; priority: NotificationPriority }[]>> = {
  WARNING: [
    { recipientRole: 'FAMILY', priority: 'NORMAL' },
    { recipientRole: 'MEDICAL', priority: 'INFO' },
  ],
  CRITICAL: [
    { recipientRole: 'MEDICAL', priority: 'URGENT' },
    { recipientRole: 'FAMILY', priority: 'URGENT' },
  ],
};

export function routeCriticalAlert(alert: CriticalAlertGeneratedPayload): RoutedNotification[] {
  const text = describe(alert.reason, alert.escalationCause, alert.severity);
  return (ROUTES[alert.severity] ?? []).map(({ recipientRole, priority }) => ({
    recipientRole,
    priority,
    title: priority === 'INFO' ? `Pour information : ${text.title}` : text.title,
    message: text.message,
  }));
}

interface Text {
  readonly title: string;
  readonly message: string;
}

/** Texte destiné aux personnes, selon le motif et la cause de l'escalade. */
export function describe(reason: AlertReason, cause: EscalationCause, severity: Severity): Text {
  if (reason === 'HELP_REQUESTED') {
    return { title: "Demande d'aide", message: "La personne a appuyé sur le bouton d'aide. Prenez contact avec elle sans attendre." };
  }
  if (reason === 'FALL_DETECTED') {
    switch (cause) {
      case 'NO_RESPONSE':
        return {
          title: 'Chute détectée, sans réponse',
          message: "Une chute a été détectée et la personne n'a pas répondu à la demande de confirmation. Prenez de ses nouvelles.",
        };
      case 'NO_RECOVERY':
        return {
          title: 'Chute : aucun signe de relèvement',
          message: "Plusieurs minutes après une chute, la personne ne s'est toujours pas relevée. Une intervention est nécessaire.",
        };
      case 'SENIOR_CONFIRMED':
        return { title: "Chute confirmée, demande d'aide", message: "La personne a confirmé avoir chuté et demande de l'aide." };
      case 'IMMEDIATE':
        return { title: 'Chute détectée', message: 'Une chute a été détectée. Prenez contact avec la personne.' };
    }
  }
  // PROLONGED_INACTIVITY
  return severity === 'CRITICAL'
    ? { title: 'Inactivité prolongée : urgence', message: "Aucune activité depuis une durée inhabituelle et aucun signe de la personne. Une intervention est nécessaire." }
    : { title: 'Inactivité inhabituelle, sans réponse', message: "Aucune activité depuis une durée inhabituelle et pas de réponse à la demande de confirmation. Prenez de ses nouvelles." };
}

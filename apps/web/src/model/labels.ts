// Libellés en français des valeurs du contrat (langage omniprésent du DDD).

import type { AlertReason, AlertStatus, CancellationCause, EscalationCause, NotificationPriority, Role, Severity } from '@project/shared-types';

export const roleLabel: Record<Role, string> = {
  SENIOR: 'Senior',
  FAMILY: 'Famille',
  MEDICAL: 'Équipe médicale',
};

export const reasonLabel: Record<AlertReason, string> = {
  FALL_DETECTED: 'Chute',
  PROLONGED_INACTIVITY: 'Inactivité prolongée',
  HELP_REQUESTED: "Demande d'aide",
};

export const statusLabel: Record<AlertStatus, string> = {
  PENDING: 'En attente',
  PRE_CONFIRMING: 'Levée de doute en cours',
  ESCALATED: 'Alerte transmise',
  RESOLVED: 'Terminée',
};

export const severityLabel: Record<Severity, string> = {
  SYSTEM: 'Technique',
  PRE_ALERT: 'Niveau 1 · levée de doute',
  WARNING: 'Niveau 2 · attention',
  CRITICAL: 'Niveau 3 · urgence',
};

export const escalationCauseLabel: Record<EscalationCause, string> = {
  NO_RESPONSE: 'Pas de réponse à la levée de doute',
  NO_RECOVERY: 'Aucun signe de relèvement ni d’activité',
  SENIOR_CONFIRMED: 'Confirmée par la personne',
  IMMEDIATE: "Demande d'aide directe",
  NO_HEART_SIGNAL: 'Pas de réponse ni de fréquence cardiaque rassurante',
};

export const cancellationCauseLabel: Record<CancellationCause, string> = {
  SENIOR_CANCELED: 'Annulée par la personne (« tout va bien »)',
  ACTIVITY_RESUMED: 'Activité reprise (relèvement détecté)',
};

export const priorityLabel: Record<NotificationPriority, string> = {
  INFO: 'Pour information',
  NORMAL: 'À traiter',
  URGENT: 'Urgent',
};

const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** « 14:32 » le jour même, « 15 janv., 14:32 » sinon. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return date.toDateString() === now.toDateString() ? timeFormat.format(date) : dateTimeFormat.format(date);
}

/** « il y a 3 min », « il y a 2 h »… */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

/** « 45 min », « 2 h », « 1 h 30 ». */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

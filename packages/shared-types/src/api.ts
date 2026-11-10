// Contrat API ↔ application web (docs/contrat-api.md) : vues exposées, authentification, temps réel.
// Réutilise les types du contrat d'événements ; ne les redéfinit pas.

import type { IsoUtcTimestamp, TopicSafeId } from './common.js';
import type { AlertReason, CancellationCause, EscalationCause, PreConfirmationRequestedPayload, Severity } from './domain-events.js';
import type { NotificationPriority } from './notifications.js';

export const Role = { SENIOR: 'SENIOR', FAMILY: 'FAMILY', MEDICAL: 'MEDICAL' } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const AlertStatus = {
  PENDING: 'PENDING',
  PRE_CONFIRMING: 'PRE_CONFIRMING',
  ESCALATED: 'ESCALATED',
  RESOLVED: 'RESOLVED',
} as const;
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];

/** Statut synthétique d'affichage (concept de vue, pas de signal métier). */
export const SeniorOverallStatus = { OK: 'OK', ALERT_IN_PROGRESS: 'ALERT_IN_PROGRESS' } as const;
export type SeniorOverallStatus = (typeof SeniorOverallStatus)[keyof typeof SeniorOverallStatus];

/** Une alerte telle que vue par l'application. Une donnée non autorisée pour le rôle vaut null. */
export interface AlertView {
  alertId: string;
  seniorId: TopicSafeId;
  status: AlertStatus;
  reason: AlertReason;
  /** Famille et médical ; null tant que l'alerte n'est pas escaladée. */
  severity: Severity | null;
  /** Médical uniquement. */
  escalationCause: EscalationCause | null;
  cancellationCause: CancellationCause | null;
  createdAt: IsoUtcTimestamp;
  acknowledgedAt: IsoUtcTimestamp | null;
  resolvedAt: IsoUtcTimestamp | null;
  /** Clôture par l'équipe médicale après intervention (alerte escaladée). */
  closedAt: IsoUtcTimestamp | null;
}

/** Un point de série temporelle (graphiques). */
export interface MeasurementPointView {
  timestamp: IsoUtcTimestamp;
  value: number;
  unit: string;
}

export interface SeniorStatusView {
  seniorId: TopicSafeId;
  overallStatus: SeniorOverallStatus;
  lastActivityAt: IsoUtcTimestamp | null;
  /** Reconstruite à partir des derniers signaux de présence. */
  currentRoom: string | null;
  activeAlert: AlertView | null;
  /** Senior et médical ; null pour la famille. */
  latestHeartRate: MeasurementPointView | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  error: { code: string; message: string };
}

// ─── Authentification (liste simple d'utilisateurs, sans mot de passe) ───

/** Un compte proposé sur l'écran de connexion. */
export interface UserSummary {
  email: string;
  fullName: string;
  role: Role;
}

export interface LoginRequest {
  email: string;
}

export interface LoginResponse {
  token: string;
  user: UserSummary;
}

export interface MeView extends UserSummary {
  personId: string;
  /** Seniors que l'appelant peut consulter (lui-même pour un senior, relations consenties sinon). */
  seniors: { seniorId: TopicSafeId; fullName: string }[];
}

// ─── Actions du senior (« tout va bien », « j'ai besoin d'aide », ADR 0007) ───

/** Réponse 202 : l'action a été transmise à l'ingestion ; son effet arrive ensuite en temps réel. */
export interface ActionAcceptedView {
  /** eventId du signal produit par l'ingestion (CANCEL_ALERT ou HELP_BUTTON). */
  eventId: string;
}

// ─── Notifications (boîte de réception de l'appelant) ───

/** Une notification remise à l'appelant (docs/format-evenements.md §9, ADR 0008). */
export interface NotificationView {
  notificationId: string;
  seniorId: TopicSafeId;
  alertId: string;
  priority: NotificationPriority;
  severity: Severity;
  reason: AlertReason;
  title: string;
  message: string;
  createdAt: IsoUtcTimestamp;
  readAt: IsoUtcTimestamp | null;
}

// ─── Temps réel (WebSocket, docs/contrat-api.md §4) ───

export interface RealtimeMessageByType {
  'alert.created': AlertView;
  'alert.updated': AlertView;
  'notification.created': NotificationView;
  'preconfirmation.requested': Pick<PreConfirmationRequestedPayload, 'alertId' | 'reason' | 'expiresAt'> & { seniorId: TopicSafeId };
}
export type RealtimeMessageType = keyof RealtimeMessageByType;

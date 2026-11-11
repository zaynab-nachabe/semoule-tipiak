// Événements de domaine publiés par la détection (docs/format-evenements.md).

import type { SensorKind } from './profiles.js';
import type { IsoUtcTimestamp, TopicSafeId, Uuid } from './common.js';

export const DomainEventType = {
  PreConfirmationRequested: 'PreConfirmationRequested',
  PreConfirmationCanceled: 'PreConfirmationCanceled',
  PreConfirmationTimeoutExpired: 'PreConfirmationTimeoutExpired',
  CriticalAlertGenerated: 'CriticalAlertGenerated',
  SensorStatusChanged: 'SensorStatusChanged',
} as const;
export type DomainEventType = (typeof DomainEventType)[keyof typeof DomainEventType];

export const AlertReason = {
  FALL_DETECTED: 'FALL_DETECTED',
  PROLONGED_INACTIVITY: 'PROLONGED_INACTIVITY',
  HELP_REQUESTED: 'HELP_REQUESTED',
} as const;
export type AlertReason = (typeof AlertReason)[keyof typeof AlertReason];

/**
 * Échelle de gravité à 4 niveaux (docs/format-evenements.md §6) :
 * 0 SYSTEM (batterie faible, événement technique), 1 PRE_ALERT (levée de doute en cours),
 * 2 WARNING (incident non infirmé), 3 CRITICAL (urgence confirmée).
 */
export const Severity = {
  SYSTEM: 'SYSTEM',
  PRE_ALERT: 'PRE_ALERT',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const EscalationCause = {
  NO_RESPONSE: 'NO_RESPONSE',
  SENIOR_CONFIRMED: 'SENIOR_CONFIRMED',
  IMMEDIATE: 'IMMEDIATE',
  NO_RECOVERY: 'NO_RECOVERY',
  /** Inactivité sans réponse et sans fréquence cardiaque récente et normale (ADR 0010). */
  NO_HEART_SIGNAL: 'NO_HEART_SIGNAL',
} as const;
export type EscalationCause = (typeof EscalationCause)[keyof typeof EscalationCause];

export const CancellationCause = {
  SENIOR_CANCELED: 'SENIOR_CANCELED',
  ACTIVITY_RESUMED: 'ACTIVITY_RESUMED',
} as const;
export type CancellationCause = (typeof CancellationCause)[keyof typeof CancellationCause];

export interface PreConfirmationRequestedPayload {
  alertId: string;
  reason: AlertReason;
  requestedAt: IsoUtcTimestamp;
  expiresAt: IsoUtcTimestamp;
  /** Signaux à l'origine du doute. Peut être vide pour une inactivité (aucun signal depuis le démarrage). */
  triggeringEventIds: Uuid[];
}

export interface PreConfirmationCanceledPayload {
  alertId: string;
  cause: CancellationCause;
  triggeringEventId: Uuid;
}

export interface PreConfirmationTimeoutExpiredPayload {
  alertId: string;
  requestedAt: IsoUtcTimestamp;
  expiresAt: IsoUtcTimestamp;
}

/** Les destinataires ne sont pas ici : la notification les choisit elle-même. */
export interface CriticalAlertGeneratedPayload {
  alertId: string;
  reason: AlertReason;
  severity: Severity;
  escalationCause: EscalationCause;
  /** Peut être vide pour une inactivité (aucun signal depuis le démarrage) ; au moins un sinon. */
  triggeringEventIds: Uuid[];
}

/** État d'un capteur attendu, tel que la détection le surveille (ADR 0012). */
export const SensorStatus = { ONLINE: 'ONLINE', OFFLINE: 'OFFLINE', LOW_BATTERY: 'LOW_BATTERY' } as const;
export type SensorStatus = (typeof SensorStatus)[keyof typeof SensorStatus];

/** Niveau 0 (SYSTEM) : un capteur devient muet, a une batterie faible, ou se remet à émettre. */
export interface SensorStatusChangedPayload {
  sensorId: TopicSafeId;
  kind: SensorKind;
  status: SensorStatus;
  severity: 'SYSTEM';
  /** Dernier signal reçu de ce capteur ; null s'il n'a rien envoyé depuis le démarrage de la détection. */
  lastSeenAt: IsoUtcTimestamp | null;
  /** Dernier niveau de batterie connu (SENSOR_HEARTBEAT) ; null s'il est inconnu. */
  battery: { value: number; unit: '%' } | null;
}

export interface DomainEventPayloadByType {
  PreConfirmationRequested: PreConfirmationRequestedPayload;
  PreConfirmationCanceled: PreConfirmationCanceledPayload;
  PreConfirmationTimeoutExpired: PreConfirmationTimeoutExpiredPayload;
  CriticalAlertGenerated: CriticalAlertGeneratedPayload;
  SensorStatusChanged: SensorStatusChangedPayload;
}

interface DomainEventOf<T extends DomainEventType> {
  eventId: Uuid;
  seniorId: TopicSafeId;
  type: T;
  timestamp: IsoUtcTimestamp;
  payload: DomainEventPayloadByType[T];
}

/** Union discriminée par `type`. */
export type DomainEvent = { [T in DomainEventType]: DomainEventOf<T> }[DomainEventType];

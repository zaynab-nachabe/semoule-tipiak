// Événements de domaine publiés par la détection (docs/format-evenements.md).

import type { IsoUtcTimestamp, TopicSafeId, Uuid } from './common.js';

export const DomainEventType = {
  PreConfirmationRequested: 'PreConfirmationRequested',
  PreConfirmationCanceled: 'PreConfirmationCanceled',
  PreConfirmationTimeoutExpired: 'PreConfirmationTimeoutExpired',
  CriticalAlertGenerated: 'CriticalAlertGenerated',
} as const;
export type DomainEventType = (typeof DomainEventType)[keyof typeof DomainEventType];

export const AlertReason = {
  FALL_DETECTED: 'FALL_DETECTED',
  PROLONGED_INACTIVITY: 'PROLONGED_INACTIVITY',
  HELP_REQUESTED: 'HELP_REQUESTED',
} as const;
export type AlertReason = (typeof AlertReason)[keyof typeof AlertReason];

export const Severity = { MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' } as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const EscalationCause = {
  NO_RESPONSE: 'NO_RESPONSE',
  SENIOR_CONFIRMED: 'SENIOR_CONFIRMED',
  IMMEDIATE: 'IMMEDIATE',
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
  triggeringEventIds: Uuid[];
}

export interface DomainEventPayloadByType {
  PreConfirmationRequested: PreConfirmationRequestedPayload;
  PreConfirmationCanceled: PreConfirmationCanceledPayload;
  PreConfirmationTimeoutExpired: PreConfirmationTimeoutExpiredPayload;
  CriticalAlertGenerated: CriticalAlertGeneratedPayload;
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

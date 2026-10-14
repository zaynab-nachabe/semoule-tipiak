// Signaux normalisés publiés par l'ingestion.

import type { IsoUtcTimestamp, TopicSafeId, Uuid } from './common.js';

export const SignalType = {
  PIR_MOTION: 'PIR_MOTION',
  PRESSURE_PLATE: 'PRESSURE_PLATE',
  HEART_RATE: 'HEART_RATE',
  FALL_IMPACT: 'FALL_IMPACT',
  HELP_BUTTON: 'HELP_BUTTON',
  CANCEL_ALERT: 'CANCEL_ALERT',
  SENSOR_HEARTBEAT: 'SENSOR_HEARTBEAT',
} as const;
export type SignalType = (typeof SignalType)[keyof typeof SignalType];

export const PressureState = { PRESSED: 'PRESSED', RELEASED: 'RELEASED' } as const;
export type PressureState = (typeof PressureState)[keyof typeof PressureState];

export interface PirMotionPayload {
  room: string;
}

export interface PressurePlatePayload {
  room: string;
  location: string;
  state: PressureState;
}

export interface HeartRatePayload {
  value: number;
  unit: 'bpm';
}

export interface FallImpactPayload {
  value: number;
  /** Accélération de la pesanteur, pas des grammes. */
  unit: 'g';
}

export type HelpButtonPayload = Record<string, never>;

export interface CancelAlertPayload {
  /** Absent si l'annulation est globale. */
  alertId?: string;
}

export interface SensorHeartbeatPayload {
  /** Pourcentage, de 0 à 100. */
  batteryLevel: number;
  unit: '%';
}

export interface SignalPayloadByType {
  PIR_MOTION: PirMotionPayload;
  PRESSURE_PLATE: PressurePlatePayload;
  HEART_RATE: HeartRatePayload;
  FALL_IMPACT: FallImpactPayload;
  HELP_BUTTON: HelpButtonPayload;
  CANCEL_ALERT: CancelAlertPayload;
  SENSOR_HEARTBEAT: SensorHeartbeatPayload;
}

interface RawSignalOf<T extends SignalType> {
  eventId: Uuid;
  seniorId: TopicSafeId;
  sensorId: TopicSafeId;
  type: T;
  timestamp: IsoUtcTimestamp;
  payload: SignalPayloadByType[T];
}

/** Union discriminée par `type` : un `switch (signal.type)` donne le bon `payload`. */
export type RawSignal = { [T in SignalType]: RawSignalOf<T> }[SignalType];

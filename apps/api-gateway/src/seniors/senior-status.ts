// Statut courant d'un senior (SeniorStatusView), reconstruit à partir du journal et de l'historique.

import type { MeasurementPointView, Role, SeniorStatusView } from '@project/shared-types';
import type { AlertRecord } from '../alerts/alert-record';
import { isInProgress, toAlertView } from '../alerts/alert-view';

export interface SignalSnapshot {
  readonly type: string;
  readonly timestamp: Date;
  readonly payload: unknown;
}

export interface StatusInputs {
  readonly seniorId: string;
  /** Alertes récentes, de la plus récente à la plus ancienne. */
  readonly recentAlerts: readonly AlertRecord[];
  /** Dernier signal de présence (PIR_MOTION ou PRESSURE_PLATE). */
  readonly lastPresence: SignalSnapshot | null;
  readonly lastHeartRate: SignalSnapshot | null;
}

export function deriveSeniorStatus(inputs: StatusInputs, role: Role): SeniorStatusView {
  const active = inputs.recentAlerts.find(isInProgress) ?? null;
  return {
    seniorId: inputs.seniorId,
    overallStatus: active ? 'ALERT_IN_PROGRESS' : 'OK',
    lastActivityAt: inputs.lastPresence?.timestamp.toISOString() ?? null,
    currentRoom: roomOf(inputs.lastPresence),
    activeAlert: active ? toAlertView(active, role) : null,
    latestHeartRate: role === 'FAMILY' ? null : toMeasurementPoint(inputs.lastHeartRate),
  };
}

export function toMeasurementPoint(signal: SignalSnapshot | null): MeasurementPointView | null {
  if (!signal || !isRecord(signal.payload)) return null;
  const { value, unit } = signal.payload;
  if (typeof value !== 'number' || typeof unit !== 'string') return null;
  return { timestamp: signal.timestamp.toISOString(), value, unit };
}

function roomOf(signal: SignalSnapshot | null): string | null {
  if (!signal || !isRecord(signal.payload)) return null;
  return typeof signal.payload.room === 'string' ? signal.payload.room : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

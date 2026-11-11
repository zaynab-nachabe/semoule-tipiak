// État des capteurs (ADR 0012) : vue projetée selon le rôle, capteurs attendus pour la détection.
// Fonctions pures, testées sans base.

import type { ExpectedSensor, Role, SensorHealthView, SensorKind, SensorStatus } from '@project/shared-types';

/** Une ligne de la table sensors. */
export interface SensorRow {
  id: string;
  kind: SensorKind;
  model: string | null;
  room: string | null;
  location: string | null;
  expectedIntervalMinutes: number;
  status: SensorStatus;
  statusChangedAt: Date | null;
}

/** Derniers signaux connus d'un capteur (historique des signaux). */
export interface SensorActivity {
  lastSeenAt: Date | null;
  battery: number | null;
}

/** Ordre d'affichage : la montre, puis les capteurs fixes par pièce. */
const KIND_ORDER: Record<SensorKind, number> = { WATCH: 0, PIR: 1, PRESSURE_PLATE: 2 };

export function sortSensors<T extends { kind: SensorKind; room: string | null; id?: string; sensorId?: string }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.room ?? '').localeCompare(b.room ?? '') ||
      (a.id ?? a.sensorId ?? '').localeCompare(b.id ?? b.sensorId ?? ''),
  );
}

/** Capteurs attendus, tels que la détection les reçoit dans le profil d'activité. */
export function toExpectedSensor(row: SensorRow): ExpectedSensor {
  return { sensorId: row.id, kind: row.kind, room: row.room, location: row.location, expectedIntervalMinutes: row.expectedIntervalMinutes };
}

/** Vue d'un capteur. Famille et senior : version simplifiée (pas de modèle ni d'intervalle attendu). */
export function toSensorHealthView(row: SensorRow, activity: SensorActivity, role: Role): SensorHealthView {
  const detailed = role === 'MEDICAL';
  return {
    sensorId: row.id,
    kind: row.kind,
    room: row.room,
    location: row.location,
    status: row.status,
    statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
    lastSeenAt: activity.lastSeenAt?.toISOString() ?? null,
    battery: activity.battery === null ? null : { value: activity.battery, unit: '%' },
    model: detailed ? row.model : null,
    expectedIntervalMinutes: detailed ? row.expectedIntervalMinutes : null,
  };
}

/** Niveau de batterie dans le payload d'un SENSOR_HEARTBEAT ({ value, unit: '%' }). */
export function batteryOf(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as { value?: unknown }).value;
  return typeof value === 'number' ? value : null;
}

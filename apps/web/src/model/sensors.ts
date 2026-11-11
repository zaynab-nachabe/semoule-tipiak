// État des capteurs (ADR 0012) : règles d'affichage pures, testées dans test/sensors.test.ts.

import type { SensorHealthView, SensorKind, SensorStatus } from '@project/shared-types';

export const sensorKindLabel: Record<SensorKind, string> = {
  WATCH: 'Montre',
  PIR: 'Détecteur de mouvement',
  PRESSURE_PLATE: 'Bande de pression',
};

export const sensorStatusLabel: Record<SensorStatus, string> = {
  ONLINE: 'En marche',
  OFFLINE: 'Muet',
  LOW_BATTERY: 'Batterie faible',
};

/** « Détecteur de mouvement · salon », « Bande de pression · chambre (lit) », « Montre ». */
export function sensorName(sensor: Pick<SensorHealthView, 'kind' | 'room' | 'location'>): string {
  const place = sensor.room ? ` · ${sensor.room}${sensor.location ? ` (${sensor.location})` : ''}` : '';
  return `${sensorKindLabel[sensor.kind]}${place}`;
}

/** Capteurs qui demandent une action (muets d'abord). */
export function sensorProblems(sensors: readonly SensorHealthView[]): SensorHealthView[] {
  const rank: Record<SensorStatus, number> = { OFFLINE: 0, LOW_BATTERY: 1, ONLINE: 2 };
  return sensors.filter((s) => s.status !== 'ONLINE').sort((a, b) => rank[a.status] - rank[b.status]);
}

/** La montre ne transmet plus : les chutes ne sont plus détectées (vue senior). */
export function isWatchSilent(sensors: readonly SensorHealthView[]): boolean {
  return sensors.some((s) => s.kind === 'WATCH' && s.status === 'OFFLINE');
}

/** Remplace un capteur reçu en temps réel. */
export function upsertSensor(sensors: readonly SensorHealthView[], next: SensorHealthView): SensorHealthView[] {
  return sensors.some((s) => s.sensorId === next.sensorId) ? sensors.map((s) => (s.sensorId === next.sensorId ? next : s)) : [...sensors, next];
}

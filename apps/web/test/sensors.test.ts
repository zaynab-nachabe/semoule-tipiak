import type { SensorHealthView } from '@project/shared-types';
import { describe, expect, it } from 'vitest';
import { isWatchSilent, sensorName, sensorProblems, upsertSensor } from '../src/model/sensors';

const sensor = (patch: Partial<SensorHealthView>): SensorHealthView => ({
  sensorId: 'pir-salon',
  kind: 'PIR',
  room: 'salon',
  location: null,
  status: 'ONLINE',
  statusChangedAt: null,
  lastSeenAt: null,
  battery: null,
  model: null,
  expectedIntervalMinutes: null,
  ...patch,
});

describe('état des capteurs (ADR 0012)', () => {
  it('nom lisible : type, pièce, emplacement', () => {
    expect(sensorName(sensor({}))).toBe('Détecteur de mouvement · salon');
    expect(sensorName(sensor({ kind: 'PRESSURE_PLATE', room: 'chambre', location: 'lit' }))).toBe('Bande de pression · chambre (lit)');
    expect(sensorName(sensor({ kind: 'WATCH', room: null }))).toBe('Montre');
  });

  it('à vérifier : les muets d abord, puis les batteries faibles', () => {
    const list = [sensor({ sensorId: 'a', status: 'LOW_BATTERY' }), sensor({ sensorId: 'b' }), sensor({ sensorId: 'c', status: 'OFFLINE' })];
    expect(sensorProblems(list).map((s) => s.sensorId)).toEqual(['c', 'a']);
  });

  it('montre muette : message dans la vue senior', () => {
    expect(isWatchSilent([sensor({ kind: 'WATCH', status: 'OFFLINE' })])).toBe(true);
    expect(isWatchSilent([sensor({ kind: 'WATCH', status: 'LOW_BATTERY' }), sensor({ status: 'OFFLINE' })])).toBe(false);
  });

  it('mise à jour en temps réel : remplace le capteur', () => {
    const next = upsertSensor([sensor({})], sensor({ status: 'OFFLINE' }));
    expect(next.map((s) => s.status)).toEqual(['OFFLINE']);
  });
});

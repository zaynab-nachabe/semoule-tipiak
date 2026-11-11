import { batteryOf, sortSensors, toExpectedSensor, toSensorHealthView, type SensorRow } from '../src/sensors/sensor-health';

const row = (patch: Partial<SensorRow> = {}): SensorRow => ({
  id: 'pir-salon',
  kind: 'PIR',
  model: 'Aqara RTCGQ11LM',
  room: 'salon',
  location: null,
  expectedIntervalMinutes: 120,
  status: 'OFFLINE',
  statusChangedAt: new Date('2026-01-15T13:02:00.000Z'),
  ...patch,
});
const activity = { lastSeenAt: new Date('2026-01-15T11:02:00.000Z'), battery: 14 };

describe('état des capteurs (ADR 0012)', () => {
  it('vue médicale : détaillée (modèle, intervalle attendu)', () => {
    expect(toSensorHealthView(row(), activity, 'MEDICAL')).toEqual({
      sensorId: 'pir-salon',
      kind: 'PIR',
      room: 'salon',
      location: null,
      status: 'OFFLINE',
      statusChangedAt: '2026-01-15T13:02:00.000Z',
      lastSeenAt: '2026-01-15T11:02:00.000Z',
      battery: { value: 14, unit: '%' },
      model: 'Aqara RTCGQ11LM',
      expectedIntervalMinutes: 120,
    });
  });

  it('vue famille et senior : simplifiée, même état', () => {
    for (const role of ['FAMILY', 'SENIOR'] as const) {
      const view = toSensorHealthView(row(), { lastSeenAt: null, battery: null }, role);
      expect([view.status, view.model, view.expectedIntervalMinutes, view.battery, view.lastSeenAt]).toEqual(['OFFLINE', null, null, null, null]);
    }
  });

  it('capteurs attendus envoyés à la détection, la montre en premier', () => {
    const sorted = sortSensors([row(), row({ id: 'watch-001', kind: 'WATCH', room: null }), row({ id: 'pir-cuisine', room: 'cuisine' })]);
    expect(sorted.map((r) => r.id)).toEqual(['watch-001', 'pir-cuisine', 'pir-salon']);
    expect(toExpectedSensor(row())).toEqual({ sensorId: 'pir-salon', kind: 'PIR', room: 'salon', location: null, expectedIntervalMinutes: 120 });
  });

  it('batterie lue dans le payload d un SENSOR_HEARTBEAT', () => {
    expect(batteryOf({ value: 84, unit: '%' })).toBe(84);
    expect(batteryOf({ room: 'salon' })).toBeNull();
    expect(batteryOf(null)).toBeNull();
  });
});

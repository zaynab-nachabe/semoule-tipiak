import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import type { NotificationRequested } from '@project/shared-types';
import { SensorNotificationService } from '../src/domain/sensor-notification-service.js';
import { routeSensorStatus, type SensorStatusEvent } from '../src/domain/sensor-routing.js';

const schema = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'packages', 'shared-types', 'schemas', 'notification.schema.json'), 'utf8'));
const validateNotification = new Ajv({ strict: true, allErrors: true }).compile(schema);

const status = (patch: Partial<SensorStatusEvent['payload']> = {}): SensorStatusEvent['payload'] => ({
  sensorId: 'pir-salon',
  kind: 'PIR',
  status: 'OFFLINE',
  severity: 'SYSTEM',
  lastSeenAt: '2026-01-15T11:02:00.000Z',
  battery: null,
  ...patch,
});
const roles = (payload: SensorStatusEvent['payload']) => routeSensorStatus(payload).map((r) => `${r.recipientRole}/${r.priority}`);

describe('routage des états de capteurs (ADR 0012)', () => {
  it('capteur fixe muet : l équipe médicale, pour information', () => {
    expect(roles(status())).toEqual(['MEDICAL/INFO']);
    expect(routeSensorStatus(status())[0]?.title).toMatch(/muet/);
  });

  it('montre muette : la famille aussi (plus de détection de chute)', () => {
    expect(roles(status({ sensorId: 'watch-001', kind: 'WATCH' }))).toEqual(['FAMILY/NORMAL', 'MEDICAL/INFO']);
  });

  it('batterie faible : l équipe médicale, avec le niveau', () => {
    const routed = routeSensorStatus(status({ status: 'LOW_BATTERY', battery: { value: 12, unit: '%' } }));
    expect(routed.map((r) => r.recipientRole)).toEqual(['MEDICAL']);
    expect(routed[0]?.title).toMatch(/12 %/);
  });

  it('de nouveau en ligne : pas de notification', () => {
    expect(routeSensorStatus(status({ status: 'ONLINE' }))).toEqual([]);
  });

  it('publie des notifications de capteur conformes au contrat (sans alerte)', () => {
    const published: NotificationRequested[] = [];
    let n = 0;
    const service = new SensorNotificationService({
      publisher: { publish: (notification) => published.push(notification) },
      clock: { now: () => new Date('2026-01-15T13:05:00.000Z') },
      ids: { next: () => `d4e5f6a7-0000-4000-8000-${String(++n).padStart(12, '0')}` },
    });
    service.onSensorStatusChanged({
      eventId: 'c1d2e3f4-0000-4000-8000-000000000001',
      seniorId: 'senior-001',
      type: 'SensorStatusChanged',
      timestamp: '2026-01-15T13:05:00.000Z',
      payload: status({ sensorId: 'watch-001', kind: 'WATCH' }),
    });
    expect(published).toHaveLength(2);
    for (const notification of published) {
      expect(notification.payload).toMatchObject({ alertId: null, sensorId: 'watch-001', severity: 'SYSTEM', reason: null, escalationCause: null });
      expect(validateNotification(notification), JSON.stringify(validateNotification.errors)).toBe(true);
    }
  });
});

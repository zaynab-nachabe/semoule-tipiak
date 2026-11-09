import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import type { CriticalAlertGeneratedPayload, NotificationRequested } from '@project/shared-types';
import { NotificationService, type CriticalAlertEvent } from '../src/domain/notification-service.js';
import { describe as describeAlert, routeCriticalAlert } from '../src/domain/routing.js';

const schema = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'packages', 'shared-types', 'schemas', 'notification.schema.json'), 'utf8'));
const validateNotification = new Ajv({ strict: true, allErrors: true }).compile(schema);

const alert = (patch: Partial<CriticalAlertGeneratedPayload> = {}): CriticalAlertGeneratedPayload => ({
  alertId: 'alert-123',
  reason: 'FALL_DETECTED',
  severity: 'WARNING',
  escalationCause: 'NO_RESPONSE',
  triggeringEventIds: ['a1b2c3d4-0000-4000-8000-000000000001'],
  ...patch,
});

describe('règle de routage (ADR 0008)', () => {
  it('niveau 2 (WARNING) : la famille agit, le médical est informé', () => {
    const routes = routeCriticalAlert(alert());
    expect(routes.map((r) => [r.recipientRole, r.priority])).toEqual([
      ['FAMILY', 'NORMAL'],
      ['MEDICAL', 'INFO'],
    ]);
    expect(routes[1]?.title.startsWith('Pour information')).toBe(true);
  });

  it('niveau 3 (CRITICAL) : médical et famille, en urgence', () => {
    const routes = routeCriticalAlert(alert({ severity: 'CRITICAL', escalationCause: 'NO_RECOVERY' }));
    expect(routes.map((r) => [r.recipientRole, r.priority])).toEqual([
      ['MEDICAL', 'URGENT'],
      ['FAMILY', 'URGENT'],
    ]);
  });

  it('le senior n\'est jamais destinataire', () => {
    for (const severity of ['WARNING', 'CRITICAL'] as const) {
      expect(routeCriticalAlert(alert({ severity })).map((r) => r.recipientRole)).not.toContain('SENIOR');
    }
  });

  it('un texte adapté à chaque motif et cause', () => {
    expect(describeAlert('FALL_DETECTED', 'NO_RESPONSE', 'WARNING').title).toMatch(/sans réponse/);
    expect(describeAlert('FALL_DETECTED', 'NO_RECOVERY', 'CRITICAL').title).toMatch(/relèvement/);
    expect(describeAlert('FALL_DETECTED', 'SENIOR_CONFIRMED', 'CRITICAL').title).toMatch(/confirmée/);
    expect(describeAlert('HELP_REQUESTED', 'IMMEDIATE', 'CRITICAL').title).toBe("Demande d'aide");
    expect(describeAlert('PROLONGED_INACTIVITY', 'NO_RESPONSE', 'WARNING').title).toMatch(/Inactivité/);
  });
});

describe('NotificationService', () => {
  it('publie une notification par rôle, conforme au contrat (notification.schema.json)', () => {
    const published: NotificationRequested[] = [];
    let n = 0;
    const service = new NotificationService({
      publisher: { publish: (notification) => published.push(notification) },
      clock: { now: () => new Date('2026-01-15T14:33:09.000Z') },
      ids: { next: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` },
    });
    const event: CriticalAlertEvent = {
      eventId: 'e0000000-0000-4000-8000-000000000001',
      seniorId: 'senior-001',
      type: 'CriticalAlertGenerated',
      timestamp: '2026-01-15T14:33:09.000Z',
      payload: alert({ severity: 'CRITICAL', escalationCause: 'SENIOR_CONFIRMED' }),
    };
    service.onCriticalAlert(event);

    expect(published).toHaveLength(2);
    for (const notification of published) {
      expect(validateNotification(notification), JSON.stringify(validateNotification.errors)).toBe(true);
      expect(notification).toMatchObject({ seniorId: 'senior-001', payload: { alertId: 'alert-123', severity: 'CRITICAL', escalationCause: 'SENIOR_CONFIRMED' } });
    }
    expect(new Set(published.map((p) => p.eventId)).size).toBe(2);
  });
});

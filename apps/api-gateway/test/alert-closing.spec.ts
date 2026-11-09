import type { DomainEvent } from '@project/shared-types';
import { acknowledgeAlert, closeAlert } from '../src/alerts/alert-closing';
import { applyDomainEvent } from '../src/alerts/alert-journal';
import type { AlertRecord } from '../src/alerts/alert-record';
import { deriveSeniorStatus } from '../src/seniors/senior-status';

const NOW = new Date('2026-01-15T15:00:00.000Z');
const alert = (patch: Partial<AlertRecord> = {}): AlertRecord => ({
  id: 'a1b2c3d4-0000-4000-8000-0000000000a1',
  seniorId: 'senior-001',
  reason: 'FALL_DETECTED',
  status: 'ESCALATED',
  severity: 'WARNING',
  escalationCause: 'NO_RESPONSE',
  cancellationCause: null,
  triggeringEventIds: [],
  createdAt: new Date('2026-01-15T14:32:09.000Z'),
  acknowledgedAt: null,
  acknowledgedById: null,
  resolvedAt: null,
  closedAt: null,
  closedById: null,
  ...patch,
});

describe('clôture d\'une alerte par l\'équipe médicale', () => {
  it('une alerte escaladée se clôture : RESOLVED, closedAt, et prise en charge implicite', () => {
    const result = closeAlert(alert(), 'dr-martin', NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).toMatchObject({ status: 'RESOLVED', resolvedAt: NOW, closedAt: NOW, closedById: 'dr-martin', acknowledgedAt: NOW, acknowledgedById: 'dr-martin' });
  });

  it('une prise en charge antérieure est conservée', () => {
    const earlier = new Date('2026-01-15T14:40:00.000Z');
    const result = closeAlert(alert({ acknowledgedAt: earlier, acknowledgedById: 'infirmiere' }), 'dr-martin', NOW);
    expect(result.ok && result.next).toMatchObject({ acknowledgedAt: earlier, acknowledgedById: 'infirmiere', closedById: 'dr-martin' });
  });

  it('une levée de doute en cours ne se clôture pas (elle appartient à la détection)', () => {
    expect(closeAlert(alert({ status: 'PRE_CONFIRMING', severity: null }), 'dr-martin', NOW)).toEqual({ ok: false, refusal: 'NOT_ESCALATED' });
  });

  it('une alerte déjà résolue ne se clôture ni ne se prend en charge', () => {
    const resolved = alert({ status: 'RESOLVED', resolvedAt: NOW });
    expect(closeAlert(resolved, 'dr-martin', NOW)).toEqual({ ok: false, refusal: 'ALREADY_RESOLVED' });
    expect(acknowledgeAlert(resolved, 'dr-martin', NOW)).toEqual({ ok: false, refusal: 'ALREADY_RESOLVED' });
  });

  it('la prise en charge est idempotente', () => {
    const acknowledged = alert({ acknowledgedAt: NOW, acknowledgedById: 'dr-martin' });
    expect(acknowledgeAlert(acknowledged, 'autre', new Date())).toEqual({ ok: true, next: acknowledged, changed: false });
  });

  it('après clôture, le statut du senior repasse à OK', () => {
    const result = closeAlert(alert(), 'dr-martin', NOW);
    if (!result.ok) throw new Error('clôture refusée');
    const status = deriveSeniorStatus({ seniorId: 'senior-001', recentAlerts: [result.next], lastPresence: null, lastHeartRate: null }, 'FAMILY');
    expect(status.overallStatus).toBe('OK');
  });

  it('une escalade tardive de la détection (niveau 3) ne rouvre pas une alerte clôturée', () => {
    const result = closeAlert(alert(), 'dr-martin', NOW);
    if (!result.ok) throw new Error('clôture refusée');
    const lateCritical: DomainEvent = {
      eventId: 'e0000000-0000-4000-8000-000000000099',
      seniorId: 'senior-001',
      type: 'CriticalAlertGenerated',
      timestamp: '2026-01-15T15:05:00.000Z',
      payload: { alertId: result.next.id, reason: 'FALL_DETECTED', severity: 'CRITICAL', escalationCause: 'NO_RECOVERY', triggeringEventIds: [] },
    };
    expect(applyDomainEvent(result.next, lateCritical).change).toBe('unchanged');
  });
});

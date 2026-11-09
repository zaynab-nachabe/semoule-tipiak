import { accessibleSeniorIds, canAccessSenior, grantedSeniorIds, hasCapability, type AccessContext, type RelationshipRecord } from '../src/access/access';
import type { AlertRecord } from '../src/alerts/alert-record';
import { isPushedTo, toAlertView } from '../src/alerts/alert-view';
import { deriveSeniorStatus } from '../src/seniors/senior-status';

const relation = (patch: Partial<RelationshipRecord>): RelationshipRecord => ({
  seniorId: 'senior-001',
  relationType: 'FAMILY',
  consentStatus: 'GRANTED',
  revokedAt: null,
  ...patch,
});

describe('règle d\'accès : rôle × relation active consentie (contrat §5)', () => {
  it('une relation consentie et non révoquée ouvre l\'accès', () => {
    expect(grantedSeniorIds('FAMILY', [relation({})])).toEqual(['senior-001']);
  });

  it('une relation en attente, refusée ou révoquée ne l\'ouvre pas', () => {
    expect(grantedSeniorIds('FAMILY', [relation({ consentStatus: 'PENDING' })])).toEqual([]);
    expect(grantedSeniorIds('FAMILY', [relation({ consentStatus: 'REVOKED' })])).toEqual([]);
    expect(grantedSeniorIds('FAMILY', [relation({ revokedAt: new Date() })])).toEqual([]);
  });

  it('le type de relation doit correspondre au rôle', () => {
    expect(grantedSeniorIds('MEDICAL', [relation({ relationType: 'FAMILY' })])).toEqual([]);
  });

  it('un senior n\'accède qu\'à lui-même', () => {
    const ctx: AccessContext = { personId: 'p1', role: 'SENIOR', ownSeniorId: 'senior-001', grantedSeniorIds: [] };
    expect(accessibleSeniorIds(ctx)).toEqual(['senior-001']);
    expect(canAccessSenior(ctx, 'senior-002')).toBe(false);
  });

  it('mesures brutes et prise en charge : médical uniquement', () => {
    expect(hasCapability('MEDICAL', 'READ_MEASUREMENTS')).toBe(true);
    expect(hasCapability('FAMILY', 'READ_MEASUREMENTS')).toBe(false);
    expect(hasCapability('SENIOR', 'ACKNOWLEDGE_ALERT')).toBe(false);
  });
});

const alert = (patch: Partial<AlertRecord> = {}): AlertRecord => ({
  id: 'alert-1',
  seniorId: 'senior-001',
  reason: 'FALL_DETECTED',
  status: 'ESCALATED',
  severity: 'CRITICAL',
  escalationCause: 'NO_RECOVERY',
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

describe('projection d\'une alerte selon le rôle (minimisation des données)', () => {
  it('médical : gravité et cause clinique', () => {
    expect(toAlertView(alert(), 'MEDICAL')).toMatchObject({ severity: 'CRITICAL', escalationCause: 'NO_RECOVERY' });
  });
  it('famille : la gravité, pas la cause clinique', () => {
    expect(toAlertView(alert(), 'FAMILY')).toMatchObject({ severity: 'CRITICAL', escalationCause: null });
  });
  it('senior : ni gravité ni cause', () => {
    expect(toAlertView(alert(), 'SENIOR')).toMatchObject({ severity: null, escalationCause: null });
  });
  it('temps réel : famille et médical seulement à partir de l\'escalade, le senior toujours', () => {
    const preConfirming = alert({ status: 'PRE_CONFIRMING', severity: null, escalationCause: null });
    expect(isPushedTo(preConfirming, 'FAMILY')).toBe(false);
    expect(isPushedTo(preConfirming, 'MEDICAL')).toBe(false);
    expect(isPushedTo(preConfirming, 'SENIOR')).toBe(true);
    expect(isPushedTo(alert(), 'FAMILY')).toBe(true);
  });
  it('temps réel : une alerte escaladée puis clôturée reste suivie par la famille et le médical', () => {
    const closed = alert({ status: 'RESOLVED', resolvedAt: new Date(), closedAt: new Date() });
    expect(isPushedTo(closed, 'FAMILY')).toBe(true);
    expect(isPushedTo(closed, 'MEDICAL')).toBe(true);
    expect(toAlertView(closed, 'FAMILY').closedAt).not.toBeNull();
  });
  it('temps réel : une levée de doute annulée (jamais escaladée) n\'est pas poussée à la famille', () => {
    const canceled = alert({ status: 'RESOLVED', severity: null, escalationCause: null, cancellationCause: 'SENIOR_CANCELED', resolvedAt: new Date() });
    expect(isPushedTo(canceled, 'FAMILY')).toBe(false);
  });
});

describe('statut d\'un senior', () => {
  const heartRate = { type: 'HEART_RATE', timestamp: new Date('2026-01-15T14:00:00.000Z'), payload: { value: 72, unit: 'bpm' } };
  const presence = { type: 'PIR_MOTION', timestamp: new Date('2026-01-15T14:05:00.000Z'), payload: { room: 'salon' } };

  it('pièce et dernière activité reconstruites depuis le dernier signal de présence', () => {
    const status = deriveSeniorStatus({ seniorId: 'senior-001', recentAlerts: [], lastPresence: presence, lastHeartRate: heartRate }, 'MEDICAL');
    expect(status).toMatchObject({ overallStatus: 'OK', currentRoom: 'salon', lastActivityAt: '2026-01-15T14:05:00.000Z' });
    expect(status.latestHeartRate).toEqual({ timestamp: '2026-01-15T14:00:00.000Z', value: 72, unit: 'bpm' });
  });

  it('la famille ne reçoit pas la fréquence cardiaque', () => {
    const status = deriveSeniorStatus({ seniorId: 'senior-001', recentAlerts: [], lastPresence: null, lastHeartRate: heartRate }, 'FAMILY');
    expect(status.latestHeartRate).toBeNull();
  });

  it('une alerte non résolue met le statut en ALERT_IN_PROGRESS ; une alerte résolue non', () => {
    const resolved = alert({ id: 'old', status: 'RESOLVED', resolvedAt: new Date() });
    expect(deriveSeniorStatus({ seniorId: 'senior-001', recentAlerts: [resolved], lastPresence: null, lastHeartRate: null }, 'FAMILY').overallStatus).toBe('OK');
    const status = deriveSeniorStatus({ seniorId: 'senior-001', recentAlerts: [alert(), resolved], lastPresence: null, lastHeartRate: null }, 'FAMILY');
    expect(status.overallStatus).toBe('ALERT_IN_PROGRESS');
    expect(status.activeAlert?.alertId).toBe('alert-1');
  });
});

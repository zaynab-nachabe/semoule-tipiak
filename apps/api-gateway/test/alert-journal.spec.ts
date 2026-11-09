import type { DomainEvent } from '@project/shared-types';
import { applyDomainEvent } from '../src/alerts/alert-journal';
import type { AlertRecord } from '../src/alerts/alert-record';

const ALERT = 'a1b2c3d4-0000-4000-8000-0000000000a1';
const IMPACT = 'a1b2c3d4-0000-4000-8000-000000000001';
let n = 0;
const base = () => ({ eventId: `e0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, seniorId: 'senior-001', timestamp: '2026-01-15T14:32:09.000Z' });

const requested = (): DomainEvent => ({
  ...base(),
  type: 'PreConfirmationRequested',
  payload: { alertId: ALERT, reason: 'FALL_DETECTED', requestedAt: '2026-01-15T14:32:09.000Z', expiresAt: '2026-01-15T14:33:09.000Z', triggeringEventIds: [IMPACT] },
});
const canceled = (): DomainEvent => ({ ...base(), type: 'PreConfirmationCanceled', payload: { alertId: ALERT, cause: 'SENIOR_CANCELED', triggeringEventId: IMPACT } });
const critical = (severity: 'WARNING' | 'CRITICAL', cause: 'NO_RESPONSE' | 'NO_RECOVERY' | 'SENIOR_CONFIRMED'): DomainEvent => ({
  ...base(),
  type: 'CriticalAlertGenerated',
  payload: { alertId: ALERT, reason: 'FALL_DETECTED', severity, escalationCause: cause, triggeringEventIds: [IMPACT] },
});

function replay(events: DomainEvent[]): { state: AlertRecord | null; changes: string[] } {
  let state: AlertRecord | null = null;
  const changes: string[] = [];
  for (const event of events) {
    const result = applyDomainEvent(state, event);
    state = result.next;
    changes.push(result.change);
  }
  return { state, changes };
}

describe('journal des alertes (événements -> table alerts)', () => {
  it('levée de doute puis annulation : PRE_CONFIRMING -> RESOLVED', () => {
    const { state, changes } = replay([requested(), canceled()]);
    expect(changes).toEqual(['created', 'updated']);
    expect(state).toMatchObject({ status: 'RESOLVED', cancellationCause: 'SENIOR_CANCELED', severity: null });
    expect(state?.resolvedAt).toBeInstanceOf(Date);
  });

  it('chute sans réponse : PRE_CONFIRMING -> ESCALATED/WARNING -> ESCALATED/CRITICAL', () => {
    const { state, changes } = replay([requested(), critical('WARNING', 'NO_RESPONSE'), critical('CRITICAL', 'NO_RECOVERY')]);
    expect(changes).toEqual(['created', 'updated', 'updated']);
    expect(state).toMatchObject({ status: 'ESCALATED', severity: 'CRITICAL', escalationCause: 'NO_RECOVERY' });
  });

  it('la gravité ne redescend jamais (CRITICAL reçu avant WARNING)', () => {
    const { state, changes } = replay([requested(), critical('CRITICAL', 'SENIOR_CONFIRMED'), critical('WARNING', 'NO_RESPONSE')]);
    expect(changes).toEqual(['created', 'updated', 'unchanged']);
    expect(state).toMatchObject({ severity: 'CRITICAL', escalationCause: 'SENIOR_CONFIRMED' });
  });

  it('escalade reçue avant la levée de doute (ordre non garanti entre topics) : pas de retour à PRE_CONFIRMING', () => {
    const { state, changes } = replay([critical('WARNING', 'NO_RESPONSE'), requested()]);
    expect(changes[0]).toBe('created');
    expect(state?.status).toBe('ESCALATED');
  });

  it('une annulation après escalade ne résout pas l\'alerte', () => {
    const { state } = replay([requested(), critical('WARNING', 'NO_RESPONSE'), canceled()]);
    expect(state?.status).toBe('ESCALATED');
  });

  it('un événement rejoué à l\'identique ne change rien (QoS 1)', () => {
    const event = critical('WARNING', 'NO_RESPONSE');
    const { changes } = replay([requested(), event, event]);
    expect(changes).toEqual(['created', 'updated', 'unchanged']);
  });

  it('une annulation sans levée de doute connue est ignorée (motif inconnu)', () => {
    expect(replay([canceled()]).state).toBeNull();
  });

  it('PreConfirmationTimeoutExpired ne change rien (l\'escalade porte l\'information)', () => {
    const timeout: DomainEvent = { ...base(), type: 'PreConfirmationTimeoutExpired', payload: { alertId: ALERT, requestedAt: '2026-01-15T14:32:09.000Z', expiresAt: '2026-01-15T14:33:09.000Z' } };
    expect(replay([requested(), timeout]).changes).toEqual(['created', 'unchanged']);
  });
});

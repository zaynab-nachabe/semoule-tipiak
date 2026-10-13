import { beforeEach, describe, expect, it } from 'vitest';
import { AlertStatus } from '../src/domain/entities/alert.js';
import { CorrelationService } from '../src/domain/services/correlation-service.js';
import { DDD_PRE_CONFIRMATION_DELAY_MS, type FallDetectionPolicy } from '../src/domain/value-objects/fall-detection-policy.js';
import { InMemoryAlertRepository } from '../src/infrastructure/in-memory-alert-repository.js';
import { CapturingPublisher, FakeTime, SequentialIds, T0, assertConformsToContract, signal } from './helpers.js';

// Valeurs de test uniquement : les vraies valeurs n'ont pas encore été décidées par l'équipe.
const TEST_POLICY: FallDetectionPolicy = {
  preConfirmationDelayMs: DDD_PRE_CONFIRMATION_DELAY_MS,
  minFallImpact: 3,
  fallAlertSeverity: 'CRITICAL',
  helpRequestSeverity: 'HIGH',
  activityResumedSignalTypes: ['PIR_MOTION', 'PRESSURE_PLATE'],
};

const ms = (s: number): number => s * 1000;
const after = (seconds: number): Date => new Date(T0.getTime() + ms(seconds));

describe('CorrelationService — détection de chute', () => {
  let time: FakeTime;
  let publisher: CapturingPublisher;
  let alerts: InMemoryAlertRepository;
  let service: CorrelationService;

  beforeEach(() => {
    time = new FakeTime();
    publisher = new CapturingPublisher();
    alerts = new InMemoryAlertRepository();
    service = new CorrelationService({ alerts, publisher, clock: time, scheduler: time, ids: new SequentialIds(), policy: TEST_POLICY });
  });

  const fall = (options: { at?: Date; seniorId?: string; value?: number } = {}) =>
    signal('FALL_IMPACT', { value: options.value ?? 9.8, unit: 'g' }, options);

  describe('DDD scénario A : chute suspectée résolue par le senior', () => {
    it('1-2. un impact déclenche immédiatement une pré-confirmation', () => {
      const impact = fall();
      service.onRawSignalReceived(impact);

      expect(publisher.types).toEqual(['PreConfirmationRequested']);
      const requested = publisher.last('PreConfirmationRequested');
      expect(requested.payload.reason).toBe('FALL_DETECTED');
      expect(requested.payload.triggeringEventIds).toEqual([impact.eventId]);
    });

    it('3. le minuteur dure 60 secondes', () => {
      service.onRawSignalReceived(fall());
      const { requestedAt, expiresAt } = publisher.last('PreConfirmationRequested').payload;
      expect(new Date(expiresAt).getTime() - new Date(requestedAt).getTime()).toBe(60_000);
    });

    it('4-5. « Non, tout va bien » annule la procédure : aucune alerte critique', () => {
      service.onRawSignalReceived(fall());
      time.advance(ms(20));
      const cancel = signal('CANCEL_ALERT', {});
      service.onRawSignalReceived(cancel);
      time.advance(ms(120));

      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationCanceled']);
      const canceled = publisher.last('PreConfirmationCanceled');
      expect(canceled.payload).toMatchObject({ cause: 'SENIOR_CANCELED', triggeringEventId: cancel.eventId });
      expect(time.pendingTasks).toBe(0);
    });

    it('5. l\'annulation est publiée pour être journalisée (historique médical)', () => {
      service.onRawSignalReceived(fall());
      service.onRawSignalReceived(signal('CANCEL_ALERT', {}));
      const requested = publisher.last('PreConfirmationRequested');
      expect(publisher.last('PreConfirmationCanceled').payload.alertId).toBe(requested.payload.alertId);
    });
  });

  describe('alerte critique : « non infirmée après expiration de la pré-confirmation »', () => {
    it('rien n\'est escaladé avant la fin du délai', () => {
      service.onRawSignalReceived(fall());
      time.advance(ms(60) - 1);
      expect(publisher.types).toEqual(['PreConfirmationRequested']);
    });

    it('sans réponse au bout de 60 s : PreConfirmationTimeoutExpired puis CriticalAlertGenerated', () => {
      const impact = fall();
      service.onRawSignalReceived(impact);
      time.advance(ms(60));

      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationTimeoutExpired', 'CriticalAlertGenerated']);
      expect(publisher.last('CriticalAlertGenerated').payload).toEqual({
        alertId: publisher.last('PreConfirmationRequested').payload.alertId,
        reason: 'FALL_DETECTED',
        severity: TEST_POLICY.fallAlertSeverity,
        escalationCause: 'NO_RESPONSE',
        triggeringEventIds: [impact.eventId],
      });
      expect(alerts.findActiveAlertsBySeniorId('senior-001')).toEqual([]);
    });
  });

  describe('alerte critique : « confirmée par le senior »', () => {
    it('le bouton d\'aide pendant la pré-confirmation escalade immédiatement', () => {
      const impact = fall();
      service.onRawSignalReceived(impact);
      time.advance(ms(10));
      const help = signal('HELP_BUTTON', {}, { at: after(10) });
      service.onRawSignalReceived(help);
      time.advance(ms(120));

      expect(publisher.types).toEqual(['PreConfirmationRequested', 'CriticalAlertGenerated']);
      expect(publisher.last('CriticalAlertGenerated').payload).toMatchObject({
        reason: 'FALL_DETECTED',
        escalationCause: 'SENIOR_CONFIRMED',
        triggeringEventIds: [impact.eventId, help.eventId],
      });
    });
  });

  describe('DDD §4.2 : « fausse alerte confirmée par un mouvement »', () => {
    it('un mouvement après l\'impact annule la pré-confirmation', () => {
      service.onRawSignalReceived(fall());
      const motion = signal('PIR_MOTION', { room: 'salon' }, { at: after(15) });
      service.onRawSignalReceived(motion);
      time.advance(ms(120));

      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationCanceled']);
      expect(publisher.last('PreConfirmationCanceled').payload).toMatchObject({ cause: 'ACTIVITY_RESUMED', triggeringEventId: motion.eventId });
    });

    it('un mouvement antérieur à l\'impact, reçu en retard, n\'annule rien', () => {
      service.onRawSignalReceived(fall());
      service.onRawSignalReceived(signal('PIR_MOTION', { room: 'salon' }, { at: after(-5) }));
      time.advance(ms(60));
      expect(publisher.types).toContain('CriticalAlertGenerated');
    });

    it('un signal hors de la liste de reprise d\'activité n\'annule rien', () => {
      service.onRawSignalReceived(fall());
      service.onRawSignalReceived(signal('HEART_RATE', { value: 80, unit: 'bpm' }, { at: after(5) }));
      time.advance(ms(60));
      expect(publisher.types).toContain('CriticalAlertGenerated');
    });
  });

  describe('cas limites', () => {
    it('un choc sous le seuil n\'entraîne rien', () => {
      service.onRawSignalReceived(fall({ value: TEST_POLICY.minFallImpact - 0.1 }));
      time.advance(ms(120));
      expect(publisher.events).toEqual([]);
    });

    it('un second impact pendant la levée de doute ne crée pas de seconde pré-confirmation', () => {
      const first = fall();
      const second = fall({ at: after(3) });
      service.onRawSignalReceived(first);
      service.onRawSignalReceived(second);
      time.advance(ms(60));

      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationTimeoutExpired', 'CriticalAlertGenerated']);
      expect(publisher.last('CriticalAlertGenerated').payload.triggeringEventIds).toEqual([first.eventId, second.eventId]);
    });

    it('une annulation visant une autre alerte est ignorée ; sans alertId elle est globale', () => {
      service.onRawSignalReceived(fall());
      service.onRawSignalReceived(signal('CANCEL_ALERT', { alertId: 'une-autre-alerte' }));
      expect(publisher.types).toEqual(['PreConfirmationRequested']);

      const alertId = publisher.last('PreConfirmationRequested').payload.alertId;
      service.onRawSignalReceived(signal('CANCEL_ALERT', { alertId }));
      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationCanceled']);
    });

    it('les signaux d\'un autre senior ne touchent pas à la levée de doute', () => {
      service.onRawSignalReceived(fall());
      service.onRawSignalReceived(signal('CANCEL_ALERT', {}, { seniorId: 'senior-002' }));
      service.onRawSignalReceived(signal('PIR_MOTION', { room: 'salon' }, { seniorId: 'senior-002', at: after(5) }));
      time.advance(ms(60));
      expect(publisher.types).toContain('CriticalAlertGenerated');
    });

    it('une annulation après l\'escalade est ignorée', () => {
      service.onRawSignalReceived(fall());
      time.advance(ms(60));
      const count = publisher.events.length;
      service.onRawSignalReceived(signal('CANCEL_ALERT', {}));
      expect(publisher.events.length).toBe(count);
    });

    it('après une annulation, un nouvel impact ouvre une nouvelle pré-confirmation', () => {
      service.onRawSignalReceived(fall());
      service.onRawSignalReceived(signal('CANCEL_ALERT', {}));
      service.onRawSignalReceived(fall({ at: after(30) }));
      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationCanceled', 'PreConfirmationRequested']);
    });
  });

  describe('demande d\'aide spontanée (docs/format-evenements.md §6)', () => {
    it('sans pré-confirmation en cours : alerte critique immédiate HELP_REQUESTED', () => {
      const help = signal('HELP_BUTTON', {});
      service.onRawSignalReceived(help);

      expect(publisher.types).toEqual(['CriticalAlertGenerated']);
      expect(publisher.last('CriticalAlertGenerated').payload).toMatchObject({
        reason: 'HELP_REQUESTED',
        severity: TEST_POLICY.helpRequestSeverity,
        escalationCause: 'IMMEDIATE',
        triggeringEventIds: [help.eventId],
      });
    });
  });

  it('tous les événements publiés respectent le contrat (domain-event.schema.json)', () => {
    service.onRawSignalReceived(fall());
    service.onRawSignalReceived(signal('CANCEL_ALERT', {}));
    service.onRawSignalReceived(fall({ at: after(30) }));
    time.advance(ms(60));
    service.onRawSignalReceived(signal('HELP_BUTTON', {}, { at: after(200) }));

    expect(new Set(publisher.types)).toEqual(
      new Set(['PreConfirmationRequested', 'PreConfirmationCanceled', 'PreConfirmationTimeoutExpired', 'CriticalAlertGenerated']),
    );
    for (const event of publisher.events) assertConformsToContract(event);
  });

  it('l\'alerte suit le cycle de vie du DDD', () => {
    service.onRawSignalReceived(fall());
    const [open] = alerts.findActiveAlertsBySeniorId('senior-001');
    expect(open?.status).toBe(AlertStatus.PRE_CONFIRMING);
    time.advance(ms(60));
    expect(open?.status).toBe(AlertStatus.ESCALATED);
  });
});

describe('FallDetectionPolicy', () => {
  const build = (policy: FallDetectionPolicy) => () =>
    new CorrelationService({
      alerts: new InMemoryAlertRepository(),
      publisher: new CapturingPublisher(),
      clock: new FakeTime(),
      scheduler: new FakeTime(),
      ids: new SequentialIds(),
      policy,
    });

  it('refuse un délai nul ou négatif', () => {
    expect(build({ ...TEST_POLICY, preConfirmationDelayMs: 0 })).toThrow();
  });
  it('refuse un seuil d\'impact négatif', () => {
    expect(build({ ...TEST_POLICY, minFallImpact: -1 })).toThrow();
  });
  it('refuse FALL_IMPACT comme preuve de reprise d\'activité', () => {
    expect(build({ ...TEST_POLICY, activityResumedSignalTypes: ['FALL_IMPACT'] })).toThrow();
  });
});

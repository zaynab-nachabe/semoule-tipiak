import { beforeEach, describe, expect, it } from 'vitest';
import { AlertStatus } from '../src/domain/entities/alert.js';
import { CorrelationService } from '../src/domain/services/correlation-service.js';
import { DEFAULT_FALL_DETECTION_POLICY, type FallDetectionPolicy } from '../src/domain/value-objects/fall-detection-policy.js';
import { InMemoryAlertRepository } from '../src/infrastructure/in-memory-alert-repository.js';
import { CapturingPublisher, FakeTime, SequentialIds, T0, assertConformsToContract, signal } from './helpers.js';

const POLICY = DEFAULT_FALL_DETECTION_POLICY; // 60 s, 3,0 g, 90 s, 5 min
const s = (seconds: number): number => seconds * 1000;
const after = (seconds: number): Date => new Date(T0.getTime() + s(seconds));

describe('CorrelationService — détection de chute', () => {
  let time: FakeTime;
  let publisher: CapturingPublisher;
  let alerts: InMemoryAlertRepository;
  let service: CorrelationService;

  const build = (policy: FallDetectionPolicy = POLICY) =>
    new CorrelationService({ alerts, publisher, clock: time, scheduler: time, ids: new SequentialIds(), policy });

  beforeEach(() => {
    time = new FakeTime();
    publisher = new CapturingPublisher();
    alerts = new InMemoryAlertRepository();
    service = build();
  });

  const fall = (options: { at?: Date; seniorId?: string; value?: number } = {}) =>
    signal('FALL_IMPACT', { value: options.value ?? 9.8, unit: 'g' }, options);
  const motion = (room: string, seconds: number, seniorId?: string) =>
    signal('PIR_MOTION', { room }, { at: after(seconds), ...(seniorId ? { seniorId } : {}) });
  const plate = (state: 'PRESSED' | 'RELEASED', seconds: number) =>
    signal('PRESSURE_PLATE', { room: 'chambre', location: 'lit', state }, { at: after(seconds), sensorId: 'plate-lit' });
  /** Simule l'arrivée d'un signal au moment de son horodatage. */
  const at = (seconds: number, raw: Parameters<CorrelationService['onRawSignalReceived']>[0]) => {
    time.advance(after(seconds).getTime() - time.now().getTime());
    service.onRawSignalReceived(raw);
  };

  describe('niveau 1 : levée de doute (DDD scénario A)', () => {
    it('un impact au-dessus de 3,0 g déclenche immédiatement une pré-confirmation de 60 s', () => {
      const impact = fall();
      service.onRawSignalReceived(impact);
      expect(publisher.types).toEqual(['PreConfirmationRequested']);
      const { payload } = publisher.last('PreConfirmationRequested');
      expect(payload.reason).toBe('FALL_DETECTED');
      expect(payload.triggeringEventIds).toEqual([impact.eventId]);
      expect(new Date(payload.expiresAt).getTime() - new Date(payload.requestedAt).getTime()).toBe(60_000);
    });

    it('un impact sous 3,0 g est un choc mineur', () => {
      service.onRawSignalReceived(fall({ value: 2.9 }));
      time.advance(s(600));
      expect(publisher.events).toEqual([]);
    });

    it('« Non, tout va bien » annule la procédure : aucune alerte', () => {
      service.onRawSignalReceived(fall());
      const cancel = signal('CANCEL_ALERT', {}, { at: after(20) });
      at(20, cancel);
      time.advance(s(600));
      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationCanceled']);
      expect(publisher.last('PreConfirmationCanceled').payload).toMatchObject({ cause: 'SENIOR_CANCELED', triggeringEventId: cancel.eventId });
      expect(time.pendingTasks).toBe(0);
    });
  });

  describe('séquence de relèvement : un seul signal ne suffit pas', () => {
    it('un mouvement seul (la personne bouge au sol) n\'annule pas', () => {
      service.onRawSignalReceived(fall());
      at(10, motion('salon', 10));
      time.advance(s(200));
      expect(publisher.types).toContain('CriticalAlertGenerated');
      expect(publisher.types).not.toContain('PreConfirmationCanceled');
    });

    it('activité puis mouvement dans une autre pièce : la personne s\'est relevée', () => {
      service.onRawSignalReceived(fall());
      at(10, motion('salon', 10));
      const confirming = motion('cuisine', 40);
      at(40, confirming);
      time.advance(s(600));
      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationCanceled']);
      expect(publisher.last('PreConfirmationCanceled').payload).toMatchObject({ cause: 'ACTIVITY_RESUMED', triggeringEventId: confirming.eventId });
    });

    it('activité puis appui sur la bande du lit : la personne est sur un meuble, pas au sol', () => {
      service.onRawSignalReceived(fall());
      at(15, motion('chambre', 15));
      at(30, plate('PRESSED', 30));
      expect(publisher.last('PreConfirmationCanceled').payload.cause).toBe('ACTIVITY_RESUMED');
    });

    it('deux mouvements dans la même pièce ne suffisent pas', () => {
      service.onRawSignalReceived(fall());
      at(5, motion('salon', 5));
      at(50, motion('salon', 50));
      time.advance(s(200));
      expect(publisher.types).not.toContain('PreConfirmationCanceled');
    });

    it('une bande relâchée (la personne se lève du lit) n\'est pas une preuve de stabilité', () => {
      service.onRawSignalReceived(fall());
      at(5, motion('chambre', 5));
      at(20, plate('RELEASED', 20));
      time.advance(s(200));
      expect(publisher.types).not.toContain('PreConfirmationCanceled');
    });

    it('un signal horodaté avant l\'impact, reçu en retard, est ignoré', () => {
      service.onRawSignalReceived(fall());
      service.onRawSignalReceived(motion('salon', -5));
      at(20, motion('cuisine', 20)); // devient la PREMIÈRE activité, pas la confirmation
      time.advance(s(200));
      expect(publisher.types).not.toContain('PreConfirmationCanceled');
    });

    it('une confirmation trop tardive (> 90 s) repart comme nouvelle activité', () => {
      // Levée de doute allongée pour isoler la règle du délai de confirmation.
      service = build({ ...POLICY, preConfirmationDelayMs: 300_000 });
      service.onRawSignalReceived(fall());
      at(5, motion('salon', 5));
      at(100, motion('cuisine', 100)); // 95 s après l'activité : devient la nouvelle activité
      at(110, motion('salon', 110)); // autre pièce, 10 s après : relèvement confirmé
      expect(publisher.types).toContain('PreConfirmationCanceled');
    });
  });

  describe('fin de levée de doute pendant un relèvement en cours', () => {
    it('activité vue mais pas encore confirmée à 60 s : la décision attend la fin du délai de 90 s', () => {
      service.onRawSignalReceived(fall());
      at(50, motion('salon', 50));
      time.advance(s(30)); // t = 80 s : levée de doute expirée, décision reportée à 50 + 90 = 140 s
      expect(publisher.types).toEqual(['PreConfirmationRequested']);
      at(120, motion('cuisine', 120));
      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationCanceled']);
    });

    it('sans confirmation à la fin du délai reporté : niveau 2', () => {
      service.onRawSignalReceived(fall());
      at(50, motion('salon', 50));
      time.advance(s(89)); // t = 139 s
      expect(publisher.types).toEqual(['PreConfirmationRequested']);
      time.advance(s(1)); // t = 140 s
      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationTimeoutExpired', 'CriticalAlertGenerated']);
    });

    it('le report n\'a lieu qu\'une fois : une personne qui bouge au sol ne repousse pas l\'alerte indéfiniment', () => {
      service.onRawSignalReceived(fall());
      at(50, motion('salon', 50));
      at(139, motion('salon', 139)); // même pièce : pas de confirmation, pas de nouveau report
      time.advance(s(1));
      expect(publisher.last('CriticalAlertGenerated').payload.severity).toBe('WARNING');
    });

    it('« tout va bien » reste possible pendant le report', () => {
      service.onRawSignalReceived(fall());
      at(50, motion('salon', 50));
      at(100, signal('CANCEL_ALERT', {}, { at: after(100) }));
      expect(publisher.last('PreConfirmationCanceled').payload.cause).toBe('SENIOR_CANCELED');
    });
  });

  describe('niveau 2 : incident non infirmé', () => {
    it('60 s sans réponse ni relèvement : PreConfirmationTimeoutExpired puis alerte WARNING', () => {
      const impact = fall();
      service.onRawSignalReceived(impact);
      time.advance(s(60) - 1);
      expect(publisher.types).toEqual(['PreConfirmationRequested']);
      time.advance(1);
      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationTimeoutExpired', 'CriticalAlertGenerated']);
      expect(publisher.last('CriticalAlertGenerated').payload).toEqual({
        alertId: publisher.last('PreConfirmationRequested').payload.alertId,
        reason: 'FALL_DETECTED',
        severity: 'WARNING',
        escalationCause: 'NO_RESPONSE',
        triggeringEventIds: [impact.eventId],
      });
    });

    it('une annulation après le niveau 2 est ignorée', () => {
      service.onRawSignalReceived(fall());
      time.advance(s(60));
      const count = publisher.events.length;
      service.onRawSignalReceived(signal('CANCEL_ALERT', {}, { at: after(70) }));
      expect(publisher.events.length).toBe(count);
    });
  });

  describe('niveau 3 : urgence confirmée', () => {
    it('bouton d\'aide pendant la levée de doute : CRITICAL, SENIOR_CONFIRMED', () => {
      const impact = fall();
      service.onRawSignalReceived(impact);
      const help = signal('HELP_BUTTON', {}, { at: after(10) });
      at(10, help);
      time.advance(s(600));
      expect(publisher.types).toEqual(['PreConfirmationRequested', 'CriticalAlertGenerated']);
      expect(publisher.last('CriticalAlertGenerated').payload).toMatchObject({
        severity: 'CRITICAL',
        escalationCause: 'SENIOR_CONFIRMED',
        triggeringEventIds: [impact.eventId, help.eventId],
      });
    });

    it('niveau 2 sans relèvement pendant 5 min : CRITICAL, NO_RECOVERY, même alerte', () => {
      service.onRawSignalReceived(fall());
      time.advance(s(60)); // niveau 2
      time.advance(s(300) - 1);
      expect(publisher.events.filter((e) => e.type === 'CriticalAlertGenerated')).toHaveLength(1);
      time.advance(1);
      const alertsSent = publisher.events.filter((e) => e.type === 'CriticalAlertGenerated');
      expect(alertsSent.map((e) => e.payload.severity)).toEqual(['WARNING', 'CRITICAL']);
      expect(alertsSent[1]?.payload).toMatchObject({ escalationCause: 'NO_RECOVERY', alertId: alertsSent[0]?.payload.alertId });
      expect(alertsSent[0]?.eventId).not.toBe(alertsSent[1]?.eventId);
      expect(time.pendingTasks).toBe(0);
    });

    it('bouton d\'aide après le niveau 2 : CRITICAL, SENIOR_CONFIRMED, pas de NO_RECOVERY ensuite', () => {
      service.onRawSignalReceived(fall());
      time.advance(s(60));
      at(120, signal('HELP_BUTTON', {}, { at: after(120) }));
      time.advance(s(600));
      const sent = publisher.events.filter((e) => e.type === 'CriticalAlertGenerated');
      expect(sent.map((e) => `${e.payload.severity}/${e.payload.escalationCause}`)).toEqual(['WARNING/NO_RESPONSE', 'CRITICAL/SENIOR_CONFIRMED']);
    });

    it('relèvement après le niveau 2 : pas de passage au niveau 3', () => {
      service.onRawSignalReceived(fall());
      time.advance(s(60));
      at(120, motion('salon', 120));
      at(150, motion('cuisine', 150));
      time.advance(s(600));
      const sent = publisher.events.filter((e) => e.type === 'CriticalAlertGenerated');
      expect(sent.map((e) => e.payload.severity)).toEqual(['WARNING']);
      expect(alerts.findActiveAlertsBySeniorId('senior-001')).toEqual([]);
      expect(time.pendingTasks).toBe(0);
    });

    it('demande d\'aide spontanée : CRITICAL, IMMEDIATE, HELP_REQUESTED', () => {
      const help = signal('HELP_BUTTON', {});
      service.onRawSignalReceived(help);
      expect(publisher.types).toEqual(['CriticalAlertGenerated']);
      expect(publisher.last('CriticalAlertGenerated').payload).toMatchObject({
        reason: 'HELP_REQUESTED',
        severity: 'CRITICAL',
        escalationCause: 'IMMEDIATE',
        triggeringEventIds: [help.eventId],
      });
    });
  });

  describe('cas limites', () => {
    it('un second impact pendant l\'incident ne crée pas de seconde pré-confirmation', () => {
      const first = fall();
      const second = fall({ at: after(3) });
      service.onRawSignalReceived(first);
      at(3, second);
      time.advance(s(60));
      expect(publisher.types.filter((t) => t === 'PreConfirmationRequested')).toHaveLength(1);
      expect(publisher.last('CriticalAlertGenerated').payload.triggeringEventIds).toEqual([first.eventId, second.eventId]);
    });

    it('une annulation visant une autre alerte est ignorée ; sans alertId elle est globale', () => {
      service.onRawSignalReceived(fall());
      service.onRawSignalReceived(signal('CANCEL_ALERT', { alertId: 'une-autre-alerte' }));
      expect(publisher.types).toEqual(['PreConfirmationRequested']);
      service.onRawSignalReceived(signal('CANCEL_ALERT', {}));
      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationCanceled']);
    });

    it('les signaux d\'un autre senior ne touchent pas l\'incident', () => {
      service.onRawSignalReceived(fall());
      service.onRawSignalReceived(signal('CANCEL_ALERT', {}, { seniorId: 'senior-002' }));
      at(5, motion('salon', 5, 'senior-002'));
      at(20, motion('cuisine', 20, 'senior-002'));
      time.advance(s(60));
      expect(publisher.types).toContain('CriticalAlertGenerated');
    });

    it('après une annulation, un nouvel impact ouvre une nouvelle pré-confirmation', () => {
      service.onRawSignalReceived(fall());
      service.onRawSignalReceived(signal('CANCEL_ALERT', {}));
      at(30, fall({ at: after(30) }));
      expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationCanceled', 'PreConfirmationRequested']);
    });

    it('les valeurs de la politique sont respectées (ex. délai de 30 s)', () => {
      service = build({ ...POLICY, preConfirmationDelayMs: 30_000 });
      service.onRawSignalReceived(fall());
      time.advance(s(30));
      expect(publisher.types).toContain('CriticalAlertGenerated');
    });
  });

  it('tous les événements publiés respectent le contrat (domain-event.schema.json)', () => {
    service.onRawSignalReceived(fall());
    at(10, signal('CANCEL_ALERT', {}, { at: after(10) }));
    at(30, fall({ at: after(30) }));
    time.advance(s(60)); // niveau 2
    time.advance(s(300)); // niveau 3
    at(1000, signal('HELP_BUTTON', {}, { at: after(1000) }));
    expect(new Set(publisher.types)).toEqual(
      new Set(['PreConfirmationRequested', 'PreConfirmationCanceled', 'PreConfirmationTimeoutExpired', 'CriticalAlertGenerated']),
    );
    for (const event of publisher.events) assertConformsToContract(event);
  });

  it('l\'alerte suit le cycle de vie : PRE_CONFIRMING -> ESCALATED/WARNING -> ESCALATED/CRITICAL', () => {
    service.onRawSignalReceived(fall());
    const [open] = alerts.findActiveAlertsBySeniorId('senior-001');
    expect(open?.status).toBe(AlertStatus.PRE_CONFIRMING);
    time.advance(s(60));
    expect([open?.status, open?.severity]).toEqual([AlertStatus.ESCALATED, 'WARNING']);
    time.advance(s(300));
    expect([open?.status, open?.severity]).toEqual([AlertStatus.ESCALATED, 'CRITICAL']);
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

  it('les valeurs par défaut sont celles des ADR', () => {
    expect(DEFAULT_FALL_DETECTION_POLICY).toEqual({
      preConfirmationDelayMs: 60_000,
      minFallImpact: 3.0,
      recoveryConfirmationWindowMs: 90_000,
      criticalEscalationDelayMs: 300_000,
    });
  });
  it('refuse un délai nul ou négatif', () => {
    expect(build({ ...POLICY, preConfirmationDelayMs: 0 })).toThrow(/preConfirmationDelayMs/);
    expect(build({ ...POLICY, criticalEscalationDelayMs: -1 })).toThrow(/criticalEscalationDelayMs/);
  });
  it('refuse un seuil d\'impact négatif ou non numérique', () => {
    expect(build({ ...POLICY, minFallImpact: -1 })).toThrow(/minFallImpact/);
    expect(build({ ...POLICY, minFallImpact: Number.NaN })).toThrow(/minFallImpact/);
  });
});

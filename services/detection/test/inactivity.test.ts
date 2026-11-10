import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityProfile as ActivityProfileData, RawSignal } from '@project/shared-types';
import { ActivityProfile, localMinutes } from '../src/domain/aggregates/activity-profile.js';
import { CorrelationService } from '../src/domain/services/correlation-service.js';
import { DEFAULT_FALL_DETECTION_POLICY } from '../src/domain/value-objects/fall-detection-policy.js';
import { DEFAULT_INACTIVITY_POLICY } from '../src/domain/value-objects/inactivity-policy.js';
import { InMemoryActivityProfileRepository } from '../src/infrastructure/in-memory-activity-profile-repository.js';
import { InMemoryAlertRepository } from '../src/infrastructure/in-memory-alert-repository.js';
import { CapturingPublisher, FakeTime, SequentialIds, T0, assertConformsToContract, signal } from './helpers.js';

// T0 = 2026-01-15T14:32:08Z, soit 15:32 à Paris (heure d'hiver) : en journée.
const min = (m: number): number => m * 60_000;
const DAY_NIGHT: ActivityProfileData = {
  seniorId: 'senior-001',
  timeZone: 'Europe/Paris',
  thresholds: [
    { condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 120, timeRange: { startTime: '07:00', endTime: '22:00' } },
    { condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 600, timeRange: { startTime: '22:00', endTime: '07:00' } },
  ],
  absence: null,
};
const profile = (data: Partial<ActivityProfileData> = {}) => ActivityProfile.fromContract({ ...DAY_NIGHT, ...data });

describe('ActivityProfile : quel seuil à quelle heure (ADR 0010)', () => {
  const utc = (iso: string) => new Date(iso);

  it('lit les plages en heure locale du logement', () => {
    expect(localMinutes(T0, 'Europe/Paris')).toBe(15 * 60 + 32);
    expect(localMinutes(utc('2026-07-01T20:30:00Z'), 'Europe/Paris')).toBe(22 * 60 + 30); // heure d'été
  });

  it('jour : 120 min ; nuit, plage qui passe minuit : 600 min', () => {
    const p = profile();
    expect(p.applicableThresholdMinutes(T0, false)).toBe(120);
    expect(p.applicableThresholdMinutes(utc('2026-01-15T22:30:00Z'), false)).toBe(600); // 23:30 à Paris
    expect(p.applicableThresholdMinutes(utc('2026-01-16T05:59:00Z'), false)).toBe(600); // 06:59
    expect(p.applicableThresholdMinutes(utc('2026-01-16T06:00:00Z'), false)).toBe(120); // 07:00
  });

  it('au lit : le seuil le plus long, même en journée', () => {
    expect(profile().applicableThresholdMinutes(T0, true)).toBe(600);
  });

  it('plusieurs plages : la plus prudente ; aucune : le seuil sans plage, sinon pas de surveillance', () => {
    const overlapping = profile({
      thresholds: [
        ...DAY_NIGHT.thresholds,
        { condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 45, timeRange: { startTime: '15:00', endTime: '16:00' } },
      ],
    });
    expect(overlapping.applicableThresholdMinutes(T0, false)).toBe(45);
    const fallback = profile({ thresholds: [{ condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 90, timeRange: null }] });
    expect(fallback.applicableThresholdMinutes(T0, false)).toBe(90);
    const nightOnly = profile({ thresholds: [DAY_NIGHT.thresholds[1]!] });
    expect(nightOnly.applicableThresholdMinutes(T0, false)).toBeNull();
    expect(profile({ thresholds: [] }).applicableThresholdMinutes(T0, true)).toBeNull();
  });

  it('refuse un fuseau horaire inconnu', () => {
    expect(() => profile({ timeZone: 'Mars/Olympus' })).toThrow(RangeError);
  });
});

describe('CorrelationService : inactivité prolongée (DDD scénario B)', () => {
  let time: FakeTime;
  let publisher: CapturingPublisher;
  let service: CorrelationService;

  beforeEach(() => {
    time = new FakeTime();
    publisher = new CapturingPublisher();
    service = new CorrelationService({
      alerts: new InMemoryAlertRepository(),
      profiles: new InMemoryActivityProfileRepository(),
      publisher,
      clock: time,
      scheduler: time,
      ids: new SequentialIds(),
      policy: DEFAULT_FALL_DETECTION_POLICY, // levée de doute 60 s, niveau 3 après 5 min
      inactivityPolicy: DEFAULT_INACTIVITY_POLICY, // vérification chaque minute, fréquence cardiaque valable 10 min
    });
    service.startInactivityMonitoring();
  });

  const now = () => time.now();
  const receive = (raw: RawSignal) => service.onRawSignalReceived(raw);
  const motion = (room = 'salon') => signal('PIR_MOTION', { room }, { at: now() });
  const heartRate = (value: number, at: Date = now()) => signal('HEART_RATE', { value, unit: 'bpm' }, { at });
  const bed = (state: 'PRESSED' | 'RELEASED') =>
    signal('PRESSURE_PLATE', { room: 'chambre', location: 'lit', state }, { at: now(), sensorId: 'plate-lit' });
  const reasons = () => publisher.events.map((e) => ('reason' in e.payload ? `${e.type}:${e.payload.reason}` : e.type));

  it('sans profil, pas de surveillance', () => {
    time.advance(min(24 * 60));
    expect(publisher.events).toEqual([]);
  });

  it('seuil atteint : levée de doute PROLONGED_INACTIVITY, sans signal à citer si rien n\'est arrivé depuis le démarrage', () => {
    service.loadProfiles([profile()]);
    time.advance(min(119));
    expect(publisher.events).toEqual([]);
    time.advance(min(2));
    const request = publisher.last('PreConfirmationRequested');
    expect(request.payload.reason).toBe('PROLONGED_INACTIVITY');
    expect(request.payload.triggeringEventIds).toEqual([]);
    assertConformsToContract(request);
  });

  it('chaque activité remet le compteur à zéro ; l\'alerte cite la dernière activité', () => {
    service.loadProfiles([profile()]);
    time.advance(min(100));
    const last = motion('cuisine');
    receive(last);
    time.advance(min(110));
    expect(publisher.events).toEqual([]);
    time.advance(min(11));
    expect(publisher.last('PreConfirmationRequested').payload.triggeringEventIds).toEqual([last.eventId]);
  });

  it('une seule activité pendant la levée de doute l\'annule (ACTIVITY_RESUMED), et le compte repart de là', () => {
    service.loadProfiles([profile()]);
    time.advance(min(120) + 20_000); // levée de doute ouverte à 120 min, réponse 20 s après
    receive(motion());
    expect(publisher.last('PreConfirmationCanceled').payload.cause).toBe('ACTIVITY_RESUMED');
    time.advance(min(119));
    expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationCanceled']);
  });

  it('« tout va bien » annule (SENIOR_CANCELED) et prouve que la personne va bien', () => {
    service.loadProfiles([profile()]);
    time.advance(min(120) + 20_000);
    receive(signal('CANCEL_ALERT', {}, { at: now() }));
    expect(publisher.last('PreConfirmationCanceled').payload.cause).toBe('SENIOR_CANCELED');
    time.advance(min(100));
    expect(publisher.types).toEqual(['PreConfirmationRequested', 'PreConfirmationCanceled']);
  });

  it('pas de réponse, fréquence cardiaque récente et normale : niveau 2, puis niveau 3 sans activité', () => {
    service.loadProfiles([profile()]);
    time.advance(min(115));
    receive(heartRate(64)); // la montre transmet : la personne est en vie, peut-être endormie
    time.advance(min(6));
    time.advance(60_000); // fin de la levée de doute
    const warning = publisher.last('CriticalAlertGenerated');
    expect([warning.payload.severity, warning.payload.escalationCause]).toEqual(['WARNING', 'NO_RESPONSE']);
    time.advance(min(5));
    const critical = publisher.last('CriticalAlertGenerated');
    expect([critical.payload.severity, critical.payload.escalationCause]).toEqual(['CRITICAL', 'NO_RECOVERY']);
    expect(critical.payload.alertId).toBe(warning.payload.alertId);
    assertConformsToContract(critical);
    time.advance(min(600));
    expect(publisher.events.filter((e) => e.type === 'PreConfirmationRequested')).toHaveLength(1); // pas de nouvelle alerte sans activité
  });

  it('pas de réponse et pas de fréquence cardiaque : niveau 3 directement (NO_HEART_SIGNAL)', () => {
    service.loadProfiles([profile()]);
    time.advance(min(122));
    const alert = publisher.last('CriticalAlertGenerated');
    expect([alert.payload.severity, alert.payload.escalationCause]).toEqual(['CRITICAL', 'NO_HEART_SIGNAL']);
    expect(reasons()).toEqual([
      'PreConfirmationRequested:PROLONGED_INACTIVITY',
      'PreConfirmationTimeoutExpired',
      'CriticalAlertGenerated:PROLONGED_INACTIVITY',
    ]);
    assertConformsToContract(alert);
  });

  it('fréquence cardiaque trop ancienne ou anormale : niveau 3 directement', () => {
    service.loadProfiles([profile()]);
    receive(heartRate(70)); // reçue au début, plus valable 2 h après
    time.advance(min(122));
    expect(publisher.last('CriticalAlertGenerated').payload.escalationCause).toBe('NO_HEART_SIGNAL');

    receive(motion()); // la personne bouge : surveillance relancée
    time.advance(min(118));
    receive(heartRate(0)); // signal plat
    time.advance(min(4));
    expect(publisher.last('CriticalAlertGenerated').payload.escalationCause).toBe('NO_HEART_SIGNAL');
    expect(publisher.events.filter((e) => e.type === 'CriticalAlertGenerated')).toHaveLength(2);
  });

  it('au lit, c\'est un repos : le seuil de nuit s\'applique même en journée', () => {
    service.loadProfiles([profile()]);
    receive(bed('PRESSED'));
    time.advance(min(200)); // 18:52 à Paris : en journée, mais au lit
    expect(publisher.events).toEqual([]);
    receive(bed('RELEASED')); // se lever est une activité
    time.advance(min(121));
    expect(publisher.last('PreConfirmationRequested').payload.reason).toBe('PROLONGED_INACTIVITY');
  });

  it('« j\'ai besoin d\'aide » pendant la levée de doute : niveau 3 (SENIOR_CONFIRMED)', () => {
    service.loadProfiles([profile()]);
    time.advance(min(120) + 20_000);
    receive(signal('HELP_BUTTON', {}, { at: now() }));
    const alert = publisher.last('CriticalAlertGenerated');
    expect([alert.payload.reason, alert.payload.severity, alert.payload.escalationCause]).toEqual(['PROLONGED_INACTIVITY', 'CRITICAL', 'SENIOR_CONFIRMED']);
  });

  it('une alerte à la fois : pas d\'alerte d\'inactivité pendant une levée de doute de chute', () => {
    service.loadProfiles([profile({ thresholds: [{ condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 1, timeRange: null }] })]);
    receive(signal('FALL_IMPACT', { value: 9.8, unit: 'g' }, { at: now() }));
    time.advance(50_000);
    expect(publisher.types).toEqual(['PreConfirmationRequested']);
    expect(publisher.last('PreConfirmationRequested').payload.reason).toBe('FALL_DETECTED');
  });

  it('profil reçu par message : remplace l\'ancien, et le chargement initial plus tardif ne l\'écrase pas', () => {
    service.onActivityProfileUpdated(profile({ thresholds: [{ condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 30, timeRange: null }] }));
    service.loadProfiles([profile()]); // réponse de l'API arrivée après le message : plus ancienne
    time.advance(min(31));
    expect(publisher.last('PreConfirmationRequested').payload.reason).toBe('PROLONGED_INACTIVITY');
  });

  it('un profil sans seuil désactive la surveillance', () => {
    service.loadProfiles([profile()]);
    service.onActivityProfileUpdated(profile({ thresholds: [] }));
    time.advance(min(24 * 60));
    expect(publisher.events).toEqual([]);
  });
});

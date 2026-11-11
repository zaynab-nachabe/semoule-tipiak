import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityProfile as ActivityProfileData } from '@project/shared-types';
import { ActivityProfile } from '../src/domain/aggregates/activity-profile.js';
import { CorrelationService } from '../src/domain/services/correlation-service.js';
import { DEFAULT_FALL_DETECTION_POLICY } from '../src/domain/value-objects/fall-detection-policy.js';
import { DEFAULT_INACTIVITY_POLICY } from '../src/domain/value-objects/inactivity-policy.js';
import { InMemoryActivityProfileRepository } from '../src/infrastructure/in-memory-activity-profile-repository.js';
import { InMemoryAlertRepository } from '../src/infrastructure/in-memory-alert-repository.js';
import { CapturingPublisher, FakeTime, SequentialIds, T0, signal } from './helpers.js';

// T0 = 15:32 à Paris. Seuil unique de 2 h, sans plage, pour isoler l'effet de l'absence (ADR 0011).
const min = (m: number): number => m * 60_000;
const after = (m: number): string => new Date(T0.getTime() + min(m)).toISOString();
const base: ActivityProfileData = {
  seniorId: 'senior-001',
  timeZone: 'Europe/Paris',
  thresholds: [{ condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 120, timeRange: null }],
  absence: null,
  sensors: [],
};
const profile = (absence: ActivityProfileData['absence']) => ActivityProfile.fromContract({ ...base, absence });

describe('ActivityProfile : absence déclarée', () => {
  it('absente jusqu au retour prévu ; le compte repart du retour prévu', () => {
    const p = profile({ since: after(0), until: after(180) });
    expect(p.isAbsentAt(new Date(after(179)))).toBe(true);
    expect(p.isAbsentAt(new Date(after(180)))).toBe(false);
    expect(p.inactiveSince(T0).toISOString()).toBe(after(180));
    expect(p.inactiveSince(new Date(after(200))).toISOString()).toBe(after(200));
    expect(profile(null).isAbsentAt(T0)).toBe(false);
  });
});

describe("CorrelationService : inactivité suspendue pendant une absence (« je m'absente »)", () => {
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
      policy: DEFAULT_FALL_DETECTION_POLICY,
      inactivityPolicy: DEFAULT_INACTIVITY_POLICY,
    });
    service.startInactivityMonitoring();
  });

  const requests = () => publisher.events.filter((e) => e.type === 'PreConfirmationRequested');

  it("pas d'alerte d'inactivité pendant l'absence, même longue", () => {
    service.loadProfiles([profile({ since: after(0), until: after(300) })]);
    time.advance(min(299));
    expect(publisher.events).toEqual([]);
  });

  it('personne pas rentrée : levée de doute au seuil habituel, compté depuis le retour prévu', () => {
    service.loadProfiles([profile({ since: after(0), until: after(60) })]);
    time.advance(min(60 + 119));
    expect(requests()).toHaveLength(0);
    time.advance(min(2));
    expect(requests()).toHaveLength(1);
    expect(publisher.last('PreConfirmationRequested').payload.reason).toBe('PROLONGED_INACTIVITY');
  });

  it('retour avant l heure prévue (« je suis rentré(e) ») : le compte repart du retour', () => {
    service.loadProfiles([profile({ since: after(0), until: after(600) })]);
    time.advance(min(30));
    service.onActivityProfileUpdated(profile(null)); // l'API a terminé l'absence
    time.advance(min(119));
    expect(requests()).toHaveLength(0);
    time.advance(min(2));
    expect(requests()).toHaveLength(1);
  });

  it("une absence déclarée par message suspend aussi la surveillance déjà en cours", () => {
    service.loadProfiles([profile(null)]);
    time.advance(min(100));
    service.onActivityProfileUpdated(profile({ since: after(100), until: after(400) }));
    time.advance(min(200));
    expect(publisher.events).toEqual([]);
  });

  it('la chute et le bouton d aide restent surveillés pendant une absence', () => {
    service.loadProfiles([profile({ since: after(0), until: after(300) })]);
    time.advance(min(10));
    service.onRawSignalReceived(signal('FALL_IMPACT', { value: 9.8, unit: 'g' }, { at: time.now() }));
    expect(publisher.last('PreConfirmationRequested').payload.reason).toBe('FALL_DETECTED');
    time.advance(30_000); // pendant la levée de doute de la chute
    service.onRawSignalReceived(signal('HELP_BUTTON', {}, { at: time.now() }));
    expect(publisher.last('CriticalAlertGenerated').payload.escalationCause).toBe('SENIOR_CONFIRMED');
  });
});

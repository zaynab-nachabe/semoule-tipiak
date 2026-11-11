import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityProfile as ActivityProfileData } from '@project/shared-types';
import { ActivityProfile } from '../src/domain/aggregates/activity-profile.js';
import { SensorSupervisionService } from '../src/domain/services/sensor-supervision-service.js';
import { DEFAULT_SENSOR_SUPERVISION_POLICY } from '../src/domain/value-objects/sensor-supervision-policy.js';
import { InMemoryActivityProfileRepository } from '../src/infrastructure/in-memory-activity-profile-repository.js';
import { CapturingPublisher, FakeTime, SequentialIds, assertConformsToContract, signal } from './helpers.js';

const min = (m: number): number => m * 60_000;
const PROFILE: ActivityProfileData = {
  seniorId: 'senior-001',
  timeZone: 'Europe/Paris',
  thresholds: [],
  absence: null,
  sensors: [
    { sensorId: 'watch-001', kind: 'WATCH', room: null, location: null, expectedIntervalMinutes: 15 },
    { sensorId: 'pir-salon', kind: 'PIR', room: 'salon', location: null, expectedIntervalMinutes: 120 },
  ],
};

describe('SensorSupervisionService : capteur muet, batterie faible (ADR 0012, risque R1)', () => {
  let time: FakeTime;
  let publisher: CapturingPublisher;
  let profiles: InMemoryActivityProfileRepository;
  let service: SensorSupervisionService;

  beforeEach(() => {
    time = new FakeTime();
    publisher = new CapturingPublisher();
    profiles = new InMemoryActivityProfileRepository();
    service = new SensorSupervisionService({
      profiles,
      publisher,
      clock: time,
      scheduler: time,
      ids: new SequentialIds(),
      policy: DEFAULT_SENSOR_SUPERVISION_POLICY, // vérification chaque minute, batterie faible sous 20 %
    });
    service.startMonitoring();
  });

  const statuses = () => publisher.events.map((e) => (e.type === 'SensorStatusChanged' ? `${e.payload.sensorId}:${e.payload.status}` : e.type));
  const heartRate = (sensorId = 'watch-001') => signal('HEART_RATE', { value: 70, unit: 'bpm' }, { at: time.now(), sensorId });
  const battery = (value: number, sensorId = 'watch-001') => signal('SENSOR_HEARTBEAT', { value, unit: '%' }, { at: time.now(), sensorId });

  it('sans profil, aucun capteur n est surveillé', () => {
    time.advance(min(600));
    expect(publisher.events).toEqual([]);
  });

  it('montre muette au-delà de 15 min : OFFLINE, une seule fois, puis ONLINE dès qu elle se manifeste', () => {
    profiles.save(ActivityProfile.fromContract(PROFILE));
    service.onRawSignalReceived(heartRate());
    time.advance(min(15));
    expect(publisher.events).toEqual([]);
    time.advance(min(2));
    expect(statuses()).toEqual(['watch-001:OFFLINE']);
    const offline = publisher.last('SensorStatusChanged');
    expect(offline.payload).toMatchObject({ kind: 'WATCH', severity: 'SYSTEM', lastSeenAt: '2026-01-15T14:32:08.000Z', battery: null });
    assertConformsToContract(offline);
    time.advance(min(60));
    expect(statuses()).toEqual(['watch-001:OFFLINE']); // pas un message par minute
    service.onRawSignalReceived(heartRate());
    expect(statuses()).toEqual(['watch-001:OFFLINE', 'watch-001:ONLINE']);
  });

  it('chaque capteur a son propre intervalle : le détecteur de mouvement tient 2 h', () => {
    profiles.save(ActivityProfile.fromContract(PROFILE));
    for (let t = 0; t < 110; t += 10) {
      service.onRawSignalReceived(heartRate());
      time.advance(min(10));
    }
    expect(publisher.events).toEqual([]);
    service.onRawSignalReceived(heartRate()); // la montre reste active
    time.advance(min(12));
    expect(statuses()).toEqual(['pir-salon:OFFLINE']);
  });

  it('un capteur qui n a jamais rien envoyé est compté depuis la première vérification après le chargement du profil', () => {
    profiles.save(ActivityProfile.fromContract(PROFILE));
    time.advance(min(17));
    const offline = publisher.last('SensorStatusChanged');
    expect([offline.payload.sensorId, offline.payload.lastSeenAt]).toEqual(['watch-001', null]);
  });

  it('batterie sous 20 % : LOW_BATTERY tout de suite ; remplacée : ONLINE', () => {
    profiles.save(ActivityProfile.fromContract(PROFILE));
    service.onRawSignalReceived(battery(12, 'pir-salon'));
    expect(statuses()).toEqual(['pir-salon:LOW_BATTERY']);
    expect(publisher.last('SensorStatusChanged').payload.battery).toEqual({ value: 12, unit: '%' });
    service.onRawSignalReceived(battery(100, 'pir-salon'));
    expect(statuses()).toEqual(['pir-salon:LOW_BATTERY', 'pir-salon:ONLINE']);
  });

  it('muet l emporte sur batterie faible', () => {
    profiles.save(ActivityProfile.fromContract(PROFILE));
    service.onRawSignalReceived(battery(5));
    time.advance(min(16));
    expect(statuses()).toEqual(['watch-001:LOW_BATTERY', 'watch-001:OFFLINE']);
    expect(publisher.last('SensorStatusChanged').payload.battery).toEqual({ value: 5, unit: '%' });
  });

  it('un signal d un capteur absent du registre ne produit rien', () => {
    profiles.save(ActivityProfile.fromContract(PROFILE));
    service.onRawSignalReceived(battery(3, 'pir-garage'));
    expect(publisher.events).toEqual([]);
  });
});

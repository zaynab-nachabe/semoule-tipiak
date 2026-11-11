// SensorSupervisionService (ADR 0012, risque R1) : un capteur attendu qui se tait est un angle mort.
// La détection retient le dernier signal et la dernière batterie de chaque capteur, et publie
// SensorStatusChanged (niveau 0, SYSTEM) à chaque changement d'état :
//
//   aucun signal depuis plus que l'intervalle attendu du capteur ─► OFFLINE
//   batterie connue sous le seuil (SENSOR_HEARTBEAT)            ─► LOW_BATTERY
//   sinon                                                         ─► ONLINE
//
// OFFLINE l'emporte. Au démarrage, chaque capteur est supposé en ligne et son silence se compte à partir de
// la première vérification qui le voit (limite connue : un capteur déjà muet avant un redémarrage est signalé en retard).

import type { DomainEvent, ExpectedSensor, RawSignal, SensorStatus } from '@project/shared-types';
import type { ActivityProfileRepository } from '../repositories/activity-profile-repository.js';
import { assertValidSupervisionPolicy, type SensorSupervisionPolicy } from '../value-objects/sensor-supervision-policy.js';
import type { Clock, DomainEventPublisher, IdGenerator, ScheduledTask, Scheduler } from './ports.js';

export interface SensorSupervisionDependencies {
  profiles: ActivityProfileRepository;
  publisher: DomainEventPublisher;
  clock: Clock;
  scheduler: Scheduler;
  ids: IdGenerator;
  policy: SensorSupervisionPolicy;
}

interface SensorState {
  /** Début de la surveillance de ce capteur (le silence se compte au plus tôt d'ici). */
  watchedSince: Date;
  lastSeenAt: Date | null;
  battery: number | null;
  status: SensorStatus;
}

const key = (seniorId: string, sensorId: string): string => `${seniorId}/${sensorId}`;

export class SensorSupervisionService {
  private readonly states = new Map<string, SensorState>();

  constructor(private readonly deps: SensorSupervisionDependencies) {
    assertValidSupervisionPolicy(deps.policy);
  }

  /** Tout signal prouve que son capteur fonctionne ; un SENSOR_HEARTBEAT donne aussi sa batterie. */
  onRawSignalReceived(signal: RawSignal): void {
    const state = this.stateOf(signal.seniorId, signal.sensorId);
    const at = new Date(signal.timestamp);
    if (!state.lastSeenAt || at.getTime() > state.lastSeenAt.getTime()) state.lastSeenAt = at;
    if (signal.type === 'SENSOR_HEARTBEAT') state.battery = signal.payload.value;
    // Retour en ligne ou batterie faible : pas besoin d'attendre la vérification suivante.
    const expected = this.expectedSensor(signal.seniorId, signal.sensorId);
    if (expected) this.evaluate(signal.seniorId, expected, this.deps.clock.now());
  }

  /** Lance la vérification périodique des capteurs muets ; renvoie de quoi l'arrêter. */
  startMonitoring(): ScheduledTask {
    let current: ScheduledTask;
    let stopped = false;
    const next = () => new Date(this.deps.clock.now().getTime() + this.deps.policy.checkIntervalMs);
    const tick = () => {
      if (stopped) return;
      this.checkSensors();
      current = this.deps.scheduler.schedule(next(), tick);
    };
    current = this.deps.scheduler.schedule(next(), tick);
    return {
      cancel: () => {
        stopped = true;
        current.cancel();
      },
    };
  }

  /** Compare, pour chaque capteur attendu, le temps sans signal à son intervalle attendu. */
  checkSensors(): void {
    const now = this.deps.clock.now();
    for (const profile of this.deps.profiles.all()) {
      for (const sensor of profile.sensors) this.evaluate(profile.seniorId, sensor, now);
    }
  }

  private evaluate(seniorId: string, sensor: ExpectedSensor, now: Date): void {
    const state = this.stateOf(seniorId, sensor.sensorId);
    const silentSince = state.lastSeenAt ?? state.watchedSince;
    const silent = now.getTime() - silentSince.getTime() > sensor.expectedIntervalMinutes * 60_000;
    const lowBattery = state.battery !== null && state.battery < this.deps.policy.lowBatteryPercent;
    const status: SensorStatus = silent ? 'OFFLINE' : lowBattery ? 'LOW_BATTERY' : 'ONLINE';
    if (status === state.status) return;
    state.status = status;
    const event = {
      eventId: this.deps.ids.next(),
      seniorId,
      type: 'SensorStatusChanged',
      timestamp: now.toISOString(),
      payload: {
        sensorId: sensor.sensorId,
        kind: sensor.kind,
        status,
        severity: 'SYSTEM',
        lastSeenAt: state.lastSeenAt?.toISOString() ?? null,
        battery: state.battery === null ? null : { value: state.battery, unit: '%' },
      },
    } satisfies DomainEvent;
    this.deps.publisher.publish(event);
  }

  private expectedSensor(seniorId: string, sensorId: string): ExpectedSensor | undefined {
    return this.deps.profiles.findBySeniorId(seniorId)?.sensors.find((s) => s.sensorId === sensorId);
  }

  private stateOf(seniorId: string, sensorId: string): SensorState {
    let state = this.states.get(key(seniorId, sensorId));
    if (!state) {
      state = { watchedSince: this.deps.clock.now(), lastSeenAt: null, battery: null, status: 'ONLINE' };
      this.states.set(key(seniorId, sensorId), state);
    }
    return state;
  }
}

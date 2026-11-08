// Test d'intégration : le service complet (adaptateurs MQTT + domaine) contre un vrai broker MQTT
// (aedes, lancé dans le processus de test). Délais raccourcis pour garder le test rapide.

import { createServer, type AddressInfo, type Server } from 'node:net';
import Aedes from 'aedes';
import { connectAsync, type MqttClient } from 'mqtt';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DomainEvent } from '@project/shared-types';
import { startDetection, type RunningDetection } from '../src/app.js';
import type { DetectionConfig } from '../src/infrastructure/config.js';
import { silentLogger } from '../src/infrastructure/logger.js';
import { assertConformsToContract } from './helpers.js';

const POLICY = { preConfirmationDelayMs: 300, minFallImpact: 3, recoveryConfirmationWindowMs: 200, criticalEscalationDelayMs: 300 };

let broker: InstanceType<typeof Aedes>;
let server: Server;
let url: string;
let observer: MqttClient;
const received: DomainEvent[] = [];
const running: RunningDetection[] = [];
let counter = 0;

const config = (clientId: string): DetectionConfig => ({ mqttUrl: url, mqttClientId: clientId, policy: POLICY });

function fallSignal(seniorId: string, eventId?: string): { topic: string; body: string; eventId: string } {
  counter += 1;
  const id = eventId ?? `a1b2c3d4-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  const signal = {
    eventId: id,
    seniorId,
    sensorId: 'watch-001',
    type: 'FALL_IMPACT',
    timestamp: new Date().toISOString(),
    payload: { value: 9.8, unit: 'g' },
  };
  return { topic: `signals/${seniorId}/FALL_IMPACT`, body: JSON.stringify(signal), eventId: id };
}

const eventsFor = (seniorId: string) => received.filter((e) => e.seniorId === seniorId);
const waitFor = async (predicate: () => boolean, ms = 3000) => {
  for (let t = 0; t < ms && !predicate(); t += 20) await new Promise((r) => setTimeout(r, 20));
  expect(predicate()).toBe(true);
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  broker = new Aedes();
  server = createServer(broker.handle);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `mqtt://127.0.0.1:${(server.address() as AddressInfo).port}`;
  observer = await connectAsync(url, { clientId: 'observer' });
  observer.on('message', (_topic, payload) => received.push(JSON.parse(payload.toString()) as DomainEvent));
  await observer.subscribeAsync('alerts/#', { qos: 1 });
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.stop()));
});

afterAll(async () => {
  await observer.endAsync();
  await new Promise<void>((r) => broker.close(() => r()));
  await new Promise<void>((r) => server.close(() => r()));
});

describe('service de détection sur MQTT', () => {
  it('chute sans réponse : niveau 1, puis niveau 2, puis niveau 3, sur alerts/{seniorId}/{type}', async () => {
    running.push(await startDetection(config('detection-a'), silentLogger));
    const { topic, body } = fallSignal('senior-a');
    await observer.publishAsync(topic, body, { qos: 1 });

    await waitFor(() => eventsFor('senior-a').length >= 4);
    const events = eventsFor('senior-a');
    expect(events.map((e) => e.type)).toEqual([
      'PreConfirmationRequested',
      'PreConfirmationTimeoutExpired',
      'CriticalAlertGenerated',
      'CriticalAlertGenerated',
    ]);
    const severities = events.filter((e) => e.type === 'CriticalAlertGenerated').map((e) => (e.type === 'CriticalAlertGenerated' ? e.payload.severity : ''));
    expect(severities).toEqual(['WARNING', 'CRITICAL']);
    for (const event of events) assertConformsToContract(event);
  });

  it('un signal reçu deux fois (QoS 1) n\'est traité qu\'une fois', async () => {
    running.push(await startDetection(config('detection-b'), silentLogger));
    const { topic, body } = fallSignal('senior-b');
    await observer.publishAsync(topic, body, { qos: 1 });
    await observer.publishAsync(topic, body, { qos: 1 });
    await waitFor(() => eventsFor('senior-b').some((e) => e.type === 'PreConfirmationRequested'));
    await pause(100);
    expect(eventsFor('senior-b').filter((e) => e.type === 'PreConfirmationRequested')).toHaveLength(1);
  });

  it('les messages invalides sont ignorés sans arrêter le service', async () => {
    running.push(await startDetection(config('detection-c'), silentLogger));
    await observer.publishAsync('signals/senior-c/FALL_IMPACT', 'pas du json', { qos: 1 });
    await observer.publishAsync('signals/senior-c/FALL_IMPACT', JSON.stringify({ type: 'FALL_IMPACT' }), { qos: 1 });
    const wrongTopic = fallSignal('senior-c');
    await observer.publishAsync('signals/autre-senior/FALL_IMPACT', wrongTopic.body, { qos: 1 });
    await pause(150);
    expect(eventsFor('senior-c')).toEqual([]);

    const valid = fallSignal('senior-c');
    await observer.publishAsync(valid.topic, valid.body, { qos: 1 });
    await waitFor(() => eventsFor('senior-c').some((e) => e.type === 'PreConfirmationRequested'));
  });

  it('session persistante : un signal publié pendant que le service est arrêté est traité au redémarrage (risque R9)', async () => {
    const first = await startDetection(config('detection-d'), silentLogger);
    await first.stop(); // le broker garde la session et l'abonnement (clean: false)

    const { topic, body } = fallSignal('senior-d');
    await observer.publishAsync(topic, body, { qos: 1 });
    await pause(100);
    expect(eventsFor('senior-d')).toEqual([]);

    running.push(await startDetection(config('detection-d'), silentLogger));
    await waitFor(() => eventsFor('senior-d').some((e) => e.type === 'PreConfirmationRequested'));
  });
});

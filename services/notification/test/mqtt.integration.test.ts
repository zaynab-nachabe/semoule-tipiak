// Test d'intégration : le service complet contre un vrai broker MQTT (aedes, dans le processus de test).

import { createServer, type AddressInfo, type Server } from 'node:net';
import Aedes from 'aedes';
import { connectAsync, type MqttClient } from 'mqtt';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NotificationRequested } from '@project/shared-types';
import { startNotification, type RunningNotification } from '../src/app.js';
import { silentLogger } from '../src/infrastructure/logger.js';

let broker: InstanceType<typeof Aedes>;
let server: Server;
let url: string;
let observer: MqttClient;
const received: NotificationRequested[] = [];
const running: RunningNotification[] = [];
let counter = 0;

function criticalAlert(seniorId: string, severity: 'WARNING' | 'CRITICAL', eventId?: string) {
  counter += 1;
  const event = {
    eventId: eventId ?? `e0000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    seniorId,
    type: 'CriticalAlertGenerated',
    timestamp: new Date().toISOString(),
    payload: {
      alertId: `alert-${seniorId}`,
      reason: 'FALL_DETECTED',
      severity,
      escalationCause: severity === 'WARNING' ? 'NO_RESPONSE' : 'NO_RECOVERY',
      triggeringEventIds: ['a1b2c3d4-0000-4000-8000-000000000001'],
    },
  };
  return { topic: `alerts/${seniorId}/CriticalAlertGenerated`, body: JSON.stringify(event) };
}

const forSenior = (seniorId: string) => received.filter((n) => n.seniorId === seniorId);
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
  observer.on('message', (_topic, payload) => received.push(JSON.parse(payload.toString()) as NotificationRequested));
  await observer.subscribeAsync('notifications/+', { qos: 1 });
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.stop()));
});

afterAll(async () => {
  await observer.endAsync();
  await new Promise<void>((r) => broker.close(() => r()));
  await new Promise<void>((r) => server.close(() => r()));
});

describe('service de notification sur MQTT', () => {
  it('niveau 2 puis niveau 3 : deux séries de notifications sur notifications/{seniorId}', async () => {
    running.push(await startNotification({ mqttUrl: url, mqttClientId: 'notification-a' }, silentLogger));
    const warning = criticalAlert('senior-a', 'WARNING');
    await observer.publishAsync(warning.topic, warning.body, { qos: 1 });
    await waitFor(() => forSenior('senior-a').length >= 2);
    const critical = criticalAlert('senior-a', 'CRITICAL');
    await observer.publishAsync(critical.topic, critical.body, { qos: 1 });
    await waitFor(() => forSenior('senior-a').length >= 4);

    expect(forSenior('senior-a').map((n) => `${n.payload.recipientRole}/${n.payload.priority}`)).toEqual([
      'FAMILY/NORMAL',
      'MEDICAL/INFO',
      'MEDICAL/URGENT',
      'FAMILY/URGENT',
    ]);
  });

  it('une alerte reçue deux fois (QoS 1) ne notifie qu\'une fois', async () => {
    running.push(await startNotification({ mqttUrl: url, mqttClientId: 'notification-b' }, silentLogger));
    const { topic, body } = criticalAlert('senior-b', 'CRITICAL', 'e0000000-0000-4000-8000-0000000000bb');
    await observer.publishAsync(topic, body, { qos: 1 });
    await observer.publishAsync(topic, body, { qos: 1 });
    await waitFor(() => forSenior('senior-b').length >= 2);
    await pause(150);
    expect(forSenior('senior-b')).toHaveLength(2);
  });

  it('les messages invalides ou d\'un autre type sont ignorés sans arrêter le service', async () => {
    running.push(await startNotification({ mqttUrl: url, mqttClientId: 'notification-c' }, silentLogger));
    await observer.publishAsync('alerts/senior-c/CriticalAlertGenerated', 'pas du json', { qos: 1 });
    const wrongTopic = criticalAlert('senior-c', 'WARNING');
    await observer.publishAsync('alerts/autre/CriticalAlertGenerated', wrongTopic.body, { qos: 1 });
    await pause(150);
    expect(forSenior('senior-c')).toEqual([]);
    const valid = criticalAlert('senior-c', 'WARNING');
    await observer.publishAsync(valid.topic, valid.body, { qos: 1 });
    await waitFor(() => forSenior('senior-c').length === 2);
  });

  it('session persistante : une alerte publiée pendant que le service est arrêté est notifiée au redémarrage', async () => {
    const first = await startNotification({ mqttUrl: url, mqttClientId: 'notification-d' }, silentLogger);
    await first.stop();
    const { topic, body } = criticalAlert('senior-d', 'CRITICAL');
    await observer.publishAsync(topic, body, { qos: 1 });
    await pause(100);
    expect(forSenior('senior-d')).toEqual([]);
    running.push(await startNotification({ mqttUrl: url, mqttClientId: 'notification-d' }, silentLogger));
    await waitFor(() => forSenior('senior-d').length === 2);
  });
});

// Assemblage du service : domaine + adaptateurs MQTT.

import { connect, type MqttClient } from 'mqtt';
import { MQTT_QOS, Subscriptions } from '@project/shared-types';
import { NotificationService } from './domain/notification-service.js';
import type { NotificationConfig } from './infrastructure/config.js';
import { jsonLogger, type Logger } from './infrastructure/logger.js';
import { MqttNotificationPublisher, createAlertHandler, systemClock, uuidGenerator } from './infrastructure/mqtt-adapter.js';

export interface RunningNotification {
  readonly client: MqttClient;
  stop(): Promise<void>;
}

/** Démarre le service ; la promesse se résout une fois abonné aux alertes avérées. */
export function startNotification(config: NotificationConfig, logger: Logger = jsonLogger): Promise<RunningNotification> {
  const client = connect(config.mqttUrl, {
    clientId: config.mqttClientId,
    clean: false, // session persistante : alertes QoS 1 conservées par le broker pendant une coupure
    reconnectPeriod: 2_000,
  });
  const service = new NotificationService({
    publisher: new MqttNotificationPublisher(client, logger),
    clock: systemClock,
    ids: uuidGenerator,
  });

  client.on('message', createAlertHandler({ onCriticalAlert: (event) => service.onCriticalAlert(event), logger }));
  client.on('reconnect', () => logger.warn('reconnexion au broker', { url: config.mqttUrl }));
  client.on('error', (error) => logger.error('erreur MQTT', { error: error.message }));

  return new Promise((resolve) => {
    client.on('connect', (connack) => {
      client.subscribe(Subscriptions.notification, { qos: MQTT_QOS }, (error) => {
        if (error) {
          logger.error('abonnement impossible', { topic: Subscriptions.notification, error: error.message });
          return;
        }
        logger.info('connecté et abonné', { url: config.mqttUrl, topic: Subscriptions.notification, sessionPresent: connack.sessionPresent });
        resolve({ client, stop: async () => void (await client.endAsync()) });
      });
    });
  });
}

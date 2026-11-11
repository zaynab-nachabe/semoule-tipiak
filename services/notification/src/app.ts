// Assemblage du service : domaine + adaptateurs MQTT.

import { connect, type MqttClient } from 'mqtt';
import { MQTT_QOS, Subscriptions } from '@project/shared-types';
import { NotificationService } from './domain/notification-service.js';
import { SensorNotificationService } from './domain/sensor-notification-service.js';
import type { NotificationConfig } from './infrastructure/config.js';
import { jsonLogger, type Logger } from './infrastructure/logger.js';
import { MqttNotificationPublisher, createAlertHandler, systemClock, uuidGenerator } from './infrastructure/mqtt-adapter.js';
import { createSensorStatusHandler } from './infrastructure/sensor-adapter.js';

export interface RunningNotification {
  readonly client: MqttClient;
  stop(): Promise<void>;
}

const TOPICS = [Subscriptions.notification, Subscriptions.notificationSensors];

/** Démarre le service ; la promesse se résout une fois abonné aux alertes avérées et aux états de capteurs. */
export function startNotification(config: NotificationConfig, logger: Logger = jsonLogger): Promise<RunningNotification> {
  const client = connect(config.mqttUrl, {
    clientId: config.mqttClientId,
    clean: false, // session persistante : alertes QoS 1 conservées par le broker pendant une coupure
    reconnectPeriod: 2_000,
  });
  const publisher = new MqttNotificationPublisher(client, logger);
  const service = new NotificationService({ publisher, clock: systemClock, ids: uuidGenerator });
  const sensors = new SensorNotificationService({ publisher, clock: systemClock, ids: uuidGenerator });

  const onAlert = createAlertHandler({ onCriticalAlert: (event) => service.onCriticalAlert(event), logger });
  const onSensor = createSensorStatusHandler({ onSensorStatus: (event) => sensors.onSensorStatusChanged(event), logger });
  client.on('message', (topic, payload) => (topic.endsWith('/SensorStatusChanged') ? onSensor(topic, payload) : onAlert(topic, payload)));
  client.on('reconnect', () => logger.warn('reconnexion au broker', { url: config.mqttUrl }));
  client.on('error', (error) => logger.error('erreur MQTT', { error: error.message }));

  return new Promise((resolve) => {
    client.on('connect', (connack) => {
      client.subscribe(TOPICS, { qos: MQTT_QOS }, (error) => {
        if (error) {
          logger.error('abonnement impossible', { topics: TOPICS, error: error.message });
          return;
        }
        logger.info('connecté et abonné', { url: config.mqttUrl, topics: TOPICS, sessionPresent: connack.sessionPresent });
        resolve({ client, stop: async () => void (await client.endAsync()) });
      });
    });
  });
}

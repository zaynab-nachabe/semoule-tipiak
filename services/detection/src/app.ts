// Assemblage du service : domaine + adaptateurs (MQTT, horloge, minuteur, UUID).

import { connect, type MqttClient } from 'mqtt';
import { MQTT_QOS, Subscriptions } from '@project/shared-types';
import { CorrelationService } from './domain/services/correlation-service.js';
import type { DetectionConfig } from './infrastructure/config.js';
import { InMemoryAlertRepository } from './infrastructure/in-memory-alert-repository.js';
import { jsonLogger, type Logger } from './infrastructure/logger.js';
import { MqttDomainEventPublisher, createSignalHandler } from './infrastructure/mqtt-adapter.js';
import { systemClock, timeoutScheduler, uuidGenerator } from './infrastructure/system.js';

export interface RunningDetection {
  readonly client: MqttClient;
  readonly service: CorrelationService;
  stop(): Promise<void>;
}

/** Démarre le service ; la promesse se résout une fois abonné à signals/+/+. */
export function startDetection(config: DetectionConfig, logger: Logger = jsonLogger): Promise<RunningDetection> {
  const client = connect(config.mqttUrl, {
    clientId: config.mqttClientId,
    clean: false, // session persistante : messages QoS 1 conservés par le broker pendant une coupure
    reconnectPeriod: 2_000,
  });

  const service = new CorrelationService({
    alerts: new InMemoryAlertRepository(),
    publisher: new MqttDomainEventPublisher(client, logger),
    clock: systemClock,
    scheduler: timeoutScheduler,
    ids: uuidGenerator,
    policy: config.policy,
  });

  client.on('message', createSignalHandler({ onSignal: (signal) => service.onRawSignalReceived(signal), logger }));
  client.on('reconnect', () => logger.warn('reconnexion au broker', { url: config.mqttUrl }));
  client.on('error', (error) => logger.error('erreur MQTT', { error: error.message }));

  const running: RunningDetection = {
    client,
    service,
    stop: async () => {
      await client.endAsync();
    },
  };

  return new Promise((resolve) => {
    client.on('connect', (connack) => {
      client.subscribe(Subscriptions.detection, { qos: MQTT_QOS }, (error) => {
        if (error) {
          logger.error('abonnement impossible', { topic: Subscriptions.detection, error: error.message });
          return;
        }
        logger.info('connecté et abonné', { url: config.mqttUrl, topic: Subscriptions.detection, sessionPresent: connack.sessionPresent });
        resolve(running);
      });
    });
  });
}

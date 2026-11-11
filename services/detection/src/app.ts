// Assemblage du service : domaine (corrélation, surveillance des capteurs) + adaptateurs (MQTT, API, horloge, minuteur, UUID).

import { connect, type MqttClient } from 'mqtt';
import { MQTT_QOS, Subscriptions } from '@project/shared-types';
import { CorrelationService } from './domain/services/correlation-service.js';
import { SensorSupervisionService } from './domain/services/sensor-supervision-service.js';
import { DEFAULT_INACTIVITY_POLICY } from './domain/value-objects/inactivity-policy.js';
import { DEFAULT_SENSOR_SUPERVISION_POLICY } from './domain/value-objects/sensor-supervision-policy.js';
import type { DetectionConfig } from './infrastructure/config.js';
import { InMemoryActivityProfileRepository } from './infrastructure/in-memory-activity-profile-repository.js';
import { InMemoryAlertRepository } from './infrastructure/in-memory-alert-repository.js';
import { jsonLogger, type Logger } from './infrastructure/logger.js';
import { MqttDomainEventPublisher, createSignalHandler } from './infrastructure/mqtt-adapter.js';
import { createProfileHandler, fetchProfilesUntilAvailable } from './infrastructure/profiles-adapter.js';
import { systemClock, timeoutScheduler, uuidGenerator } from './infrastructure/system.js';

export interface RunningDetection {
  readonly client: MqttClient;
  readonly service: CorrelationService;
  stop(): Promise<void>;
}

const TOPICS = [Subscriptions.detection, Subscriptions.detectionProfiles];

/** Démarre le service ; la promesse se résout une fois abonné aux signaux et aux profils. */
export function startDetection(config: DetectionConfig, logger: Logger = jsonLogger): Promise<RunningDetection> {
  const client = connect(config.mqttUrl, {
    clientId: config.mqttClientId,
    clean: false, // session persistante : messages QoS 1 conservés par le broker pendant une coupure
    reconnectPeriod: 2_000,
  });

  const profiles = new InMemoryActivityProfileRepository();
  const publisher = new MqttDomainEventPublisher(client, logger);
  const service = new CorrelationService({
    alerts: new InMemoryAlertRepository(),
    profiles,
    publisher,
    clock: systemClock,
    scheduler: timeoutScheduler,
    ids: uuidGenerator,
    policy: config.policy,
    inactivityPolicy: config.inactivityPolicy ?? DEFAULT_INACTIVITY_POLICY,
  });

  // Surveillance des capteurs (ADR 0012) : mêmes profils (capteurs attendus), mêmes signaux.
  const supervision = new SensorSupervisionService({
    profiles,
    publisher,
    clock: systemClock,
    scheduler: timeoutScheduler,
    ids: uuidGenerator,
    policy: config.supervisionPolicy ?? DEFAULT_SENSOR_SUPERVISION_POLICY,
  });

  const onSignal = createSignalHandler({
    onSignal: (signal) => {
      service.onRawSignalReceived(signal);
      supervision.onRawSignalReceived(signal);
    },
    logger,
  });
  const onProfile = createProfileHandler({ onProfile: (profile) => service.onActivityProfileUpdated(profile), logger });
  client.on('message', (topic, payload) => (topic.startsWith('profiles/') ? onProfile(topic, payload) : onSignal(topic, payload)));
  client.on('reconnect', () => logger.warn('reconnexion au broker', { url: config.mqttUrl }));
  client.on('error', (error) => logger.error('erreur MQTT', { error: error.message }));

  // Seuils d'inactivité : chargés à l'API en arrière-plan (elle peut démarrer après nous), puis vérifiés périodiquement.
  let stopped = false;
  const monitoring = service.startInactivityMonitoring();
  const sensorMonitoring = supervision.startMonitoring();
  if (config.profileSource) {
    void fetchProfilesUntilAvailable(config.profileSource, logger, () => stopped).then((profiles) => {
      if (profiles) service.loadProfiles(profiles);
    });
  }

  const running: RunningDetection = {
    client,
    service,
    stop: async () => {
      stopped = true;
      monitoring.cancel();
      sensorMonitoring.cancel();
      await client.endAsync();
    },
  };

  return new Promise((resolve) => {
    client.on('connect', (connack) => {
      client.subscribe(TOPICS, { qos: MQTT_QOS }, (error) => {
        if (error) {
          logger.error('abonnement impossible', { topics: TOPICS, error: error.message });
          return;
        }
        logger.info('connecté et abonné', { url: config.mqttUrl, topics: TOPICS, sessionPresent: connack.sessionPresent });
        resolve(running);
      });
    });
  });
}

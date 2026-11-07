/**
 * Noms des topics MQTT (docs/topics-mqtt.md)
 * Ne pas écrire les topics à la main dans les services.
 */

import type { TopicSafeId } from './common.js';
import type { DomainEventType } from './domain-events.js';
import type { SignalType } from './signals.js';

export const Topics = {
  /** Message brut d'un capteur fixe, avant normalisation. */
  sensorRaw: (sensorId: TopicSafeId): string => `sensors/${sensorId}`,
  /** Signal normalisé. */
  signal: (seniorId: TopicSafeId, type: SignalType): string => `signals/${seniorId}/${type}`,
  /** Événement de domaine émis par la détection. */
  alert: (seniorId: TopicSafeId, type: DomainEventType): string => `alerts/${seniorId}/${type}`,
  /** Messages que l'ingestion n'a pas pu normaliser. */
  rejected: 'ingestion/rejected',
} as const;

/** Abonnements par service, avec jokers MQTT. */
export const Subscriptions = {
  ingestion: 'sensors/+',
  detection: 'signals/+/+',
  notification: [
    'alerts/+/CriticalAlertGenerated',
    'alerts/+/PreConfirmationRequested',
  ],
  apiGateway: 'alerts/#',
  history: 'signals/#',
} as const;

/** Route HTTP de Node-RED pour la montre (hors MQTT). */
export const WATCH_INGEST_ROUTE = '/ingest/watch';

/** QoS MQTT utilisé pour tous les topics normalisés. */
export const MQTT_QOS = 1;

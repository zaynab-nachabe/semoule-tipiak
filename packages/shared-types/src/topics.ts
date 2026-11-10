/**
 * Noms des topics MQTT (docs/topics-mqtt.md)
 * Ne pas écrire les topics à la main dans les services.
 */

import type { TopicSafeId } from './common.js';
import type { DomainEventType } from './domain-events.js';
import type { SignalType } from './signals.js';

export const Topics = {
  /** Message brut d'un capteur fixe, avant normalisation. */
  sensorRaw: (sensorId: TopicSafeId): string => `zigbee2mqtt/${sensorId}`,
  /** Signal normalisé. */
  signal: (seniorId: TopicSafeId, type: SignalType): string => `signals/${seniorId}/${type}`,
  /** Événement de domaine émis par la détection. */
  alert: (seniorId: TopicSafeId, type: DomainEventType): string => `alerts/${seniorId}/${type}`,
  /** Notification émise par le service de notification. */
  notification: (seniorId: TopicSafeId): string => `notifications/${seniorId}`,
  /** Profil d'activité (seuils d'inactivité) modifié, publié par l'API. */
  profile: (seniorId: TopicSafeId): string => `profiles/${seniorId}`,
  /** Messages que l'ingestion n'a pas pu normaliser. */
  rejected: 'ingestion/rejected',
} as const;

/** Abonnements par service, avec jokers MQTT. */
export const Subscriptions = {
  ingestion: 'zigbee2mqtt/+',
  detection: 'signals/+/+',
  notification: 'alerts/+/CriticalAlertGenerated',
  apiGateway: 'alerts/#',
  apiNotifications: 'notifications/+',
  history: 'signals/#',
  detectionProfiles: 'profiles/+',
} as const;

/** Route de l'API qui fournit tous les profils d'activité à la détection (en-tête SERVICE_TOKEN_HEADER). */
export const INTERNAL_PROFILES_ROUTE = '/internal/activity-profiles';
export const SERVICE_TOKEN_HEADER = 'x-service-token';

/** Route HTTP de Node-RED pour la montre (hors MQTT). */
export const WATCH_INGEST_ROUTE = '/ingest/watch';

/** Route HTTP de Node-RED pour les actions de l'application web, transmises par l'API (ADR 0007). */
export const APP_INGEST_ROUTE = '/ingest/app';

/** Source « application » d'un senior dans le registre des capteurs de Node-RED (ex. app-senior-001). */
export const appSourceId = (seniorId: string): string => `app-${seniorId}`;

/** QoS MQTT utilisé pour tous les topics normalisés. */
export const MQTT_QOS = 1;

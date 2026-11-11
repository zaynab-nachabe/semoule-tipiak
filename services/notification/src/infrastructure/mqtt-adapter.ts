// Adaptateurs MQTT : réception des alertes avérées, publication des notifications.

import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import type { MqttClient } from 'mqtt';
import { MQTT_QOS, Topics, type DomainEvent, type NotificationRequested } from '@project/shared-types';
import domainEventSchema from '@project/shared-types/schemas/domain-event.schema.json';
import type { Clock, CriticalAlertEvent, IdGenerator, NotificationPublisher } from '../domain/notification-service.js';
import type { Logger } from './logger.js';
import { RecentIds } from './recent-ids.js';

const validateEvent = new Ajv({ strict: true, allErrors: true }).compile<DomainEvent>(domainEventSchema);

export const systemClock: Clock = { now: () => new Date() };
export const uuidGenerator: IdGenerator = { next: () => randomUUID() };

/** Publie chaque notification sur notifications/{seniorId} (QoS 1, sans retain) et la journalise. */
export class MqttNotificationPublisher implements NotificationPublisher {
  constructor(
    private readonly client: MqttClient,
    private readonly logger: Logger,
  ) {}

  publish(notification: NotificationRequested): void {
    const topic = Topics.notification(notification.seniorId);
    this.client.publish(topic, JSON.stringify(notification), { qos: MQTT_QOS, retain: false }, (error) => {
      if (error) this.logger.error('publication impossible', { topic, eventId: notification.eventId, error: error.message });
    });
    const p = notification.payload;
    this.logger.info('notification envoyée', {
      topic,
      eventId: notification.eventId,
      alertId: p.alertId,
      sensorId: p.sensorId,
      recipientRole: p.recipientRole,
      priority: p.priority,
      severity: p.severity,
      title: p.title,
    });
  }
}

/** Traite un message reçu sur alerts/{seniorId}/CriticalAlertGenerated ; un message refusé est journalisé et ignoré. */
export function createAlertHandler(deps: {
  onCriticalAlert(event: CriticalAlertEvent): void;
  logger: Logger;
  recentIds?: RecentIds;
}): (topic: string, payload: Buffer) => void {
  const recentIds = deps.recentIds ?? new RecentIds();
  return (topic, payload) => {
    let data: unknown;
    try {
      data = JSON.parse(payload.toString('utf8'));
    } catch {
      deps.logger.warn('alerte ignorée : JSON invalide', { topic });
      return;
    }
    if (!validateEvent(data)) {
      deps.logger.warn('alerte ignorée : non conforme au contrat', { topic, errors: validateEvent.errors });
      return;
    }
    const event = data;
    if (event.type !== 'CriticalAlertGenerated' || Topics.alert(event.seniorId, event.type) !== topic) {
      deps.logger.warn('message ignoré : type ou topic inattendu', { topic, type: event.type });
      return;
    }
    if (!recentIds.remember(event.eventId)) {
      deps.logger.info('alerte en double ignorée', { topic, eventId: event.eventId });
      return;
    }
    try {
      deps.onCriticalAlert(event);
    } catch (error) {
      deps.logger.error('erreur pendant le traitement', { topic, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

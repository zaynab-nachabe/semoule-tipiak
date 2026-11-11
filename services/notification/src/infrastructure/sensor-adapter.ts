// Adaptateur MQTT des états de capteurs (ADR 0012) : alerts/{seniorId}/SensorStatusChanged.

import Ajv from 'ajv';
import { Topics, type DomainEvent } from '@project/shared-types';
import domainEventSchema from '@project/shared-types/schemas/domain-event.schema.json';
import type { SensorStatusEvent } from '../domain/sensor-routing.js';
import type { Logger } from './logger.js';
import { RecentIds } from './recent-ids.js';

const validateEvent = new Ajv({ strict: true, allErrors: true }).compile<DomainEvent>(domainEventSchema);

/** Traite un message reçu sur alerts/{seniorId}/SensorStatusChanged ; un message refusé est journalisé et ignoré. */
export function createSensorStatusHandler(deps: {
  onSensorStatus(event: SensorStatusEvent): void;
  logger: Logger;
  recentIds?: RecentIds;
}): (topic: string, payload: Buffer) => void {
  const recentIds = deps.recentIds ?? new RecentIds();
  return (topic, payload) => {
    let data: unknown;
    try {
      data = JSON.parse(payload.toString('utf8'));
    } catch {
      deps.logger.warn('état de capteur ignoré : JSON invalide', { topic });
      return;
    }
    if (!validateEvent(data)) {
      deps.logger.warn('état de capteur ignoré : non conforme au contrat', { topic, errors: validateEvent.errors });
      return;
    }
    const event = data;
    if (event.type !== 'SensorStatusChanged' || Topics.alert(event.seniorId, event.type) !== topic) {
      deps.logger.warn('message ignoré : type ou topic inattendu', { topic, type: event.type });
      return;
    }
    if (!recentIds.remember(event.eventId)) return;
    try {
      deps.onSensorStatus(event);
    } catch (error) {
      deps.logger.error('erreur pendant le traitement', { topic, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

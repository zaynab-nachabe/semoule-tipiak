// Adaptateurs MQTT : réception des signaux normalisés, publication des événements de domaine.
// Le domaine (CorrelationService) ne connaît ni MQTT ni JSON : tout passe par ces adaptateurs.

import Ajv from 'ajv';
import type { MqttClient } from 'mqtt';
import { MQTT_QOS, Topics, type DomainEvent, type RawSignal } from '@project/shared-types';
import rawSignalSchema from '@project/shared-types/schemas/raw-signal.schema.json';
import type { DomainEventPublisher } from '../domain/services/ports.js';
import type { Logger } from './logger.js';
import { RecentIds } from './recent-ids.js';

const validateSignal = new Ajv({ strict: true, allErrors: true }).compile<RawSignal>(rawSignalSchema);

/** Publie chaque événement de domaine sur alerts/{seniorId}/{eventType} (QoS 1, sans retain) et le journalise. */
export class MqttDomainEventPublisher implements DomainEventPublisher {
  constructor(
    private readonly client: MqttClient,
    private readonly logger: Logger,
  ) {}

  publish(event: DomainEvent): void {
    const topic = Topics.alert(event.seniorId, event.type);
    this.client.publish(topic, JSON.stringify(event), { qos: MQTT_QOS, retain: false }, (error) => {
      if (error) this.logger.error('publication impossible', { topic, eventId: event.eventId, error: error.message });
    });
    this.logger.info('événement publié', {
      topic,
      eventId: event.eventId,
      type: event.type,
      alertId: event.payload.alertId,
      ...(event.type === 'CriticalAlertGenerated'
        ? { severity: event.payload.severity, escalationCause: event.payload.escalationCause }
        : {}),
    });
  }
}

export interface SignalHandlerDependencies {
  onSignal(signal: RawSignal): void;
  logger: Logger;
  recentIds?: RecentIds;
}

/**
 * Traite un message reçu sur signals/{seniorId}/{type} : JSON valide, conforme au contrat, cohérent
 * avec son topic et pas déjà reçu. Un message refusé est journalisé et ignoré, sans arrêter le service.
 */
export function createSignalHandler(deps: SignalHandlerDependencies): (topic: string, payload: Buffer) => void {
  const recentIds = deps.recentIds ?? new RecentIds();
  return (topic, payload) => {
    let data: unknown;
    try {
      data = JSON.parse(payload.toString('utf8'));
    } catch {
      deps.logger.warn('signal ignoré : JSON invalide', { topic });
      return;
    }
    if (!validateSignal(data)) {
      deps.logger.warn('signal ignoré : non conforme au contrat', { topic, errors: validateSignal.errors });
      return;
    }
    const signal = data;
    if (Topics.signal(signal.seniorId, signal.type) !== topic) {
      deps.logger.warn('signal ignoré : topic incohérent avec le contenu', { topic, seniorId: signal.seniorId, type: signal.type });
      return;
    }
    if (!recentIds.remember(signal.eventId)) {
      deps.logger.info('signal en double ignoré', { topic, eventId: signal.eventId });
      return;
    }
    try {
      deps.onSignal(signal);
    } catch (error) {
      deps.logger.error('erreur pendant le traitement du signal', {
        topic,
        eventId: signal.eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

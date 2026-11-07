// Dépendances techniques du domaine, sous forme d'interfaces.
// Les implémentations vivent dans src/infrastructure ; les tests en fournissent des versions contrôlées.

import type { DomainEvent } from '@project/shared-types';

export interface Clock {
  now(): Date;
}

export interface ScheduledTask {
  cancel(): void;
}

/** Minuteur interne (DDD §4.4 : PreConfirmationTimeoutExpired est « déclenché par un minuteur interne »). */
export interface Scheduler {
  schedule(at: Date, task: () => void): ScheduledTask;
}

/** Produit des UUID (eventId, alertId). */
export interface IdGenerator {
  next(): string;
}

/** Publication des événements de domaine (topic alerts/{seniorId}/{eventType}). */
export interface DomainEventPublisher {
  publish(event: DomainEvent): void;
}

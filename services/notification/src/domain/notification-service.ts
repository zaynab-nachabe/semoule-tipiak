// Service de notification (Notification Context, DDD §3.3) : une alerte avérée devient une
// notification par rôle destinataire. Ne connaît ni MQTT ni les personnes (l'API les résout).

import type { DomainEvent, NotificationRequested } from '@project/shared-types';
import { routeCriticalAlert } from './routing.js';

export type CriticalAlertEvent = Extract<DomainEvent, { type: 'CriticalAlertGenerated' }>;

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface NotificationPublisher {
  publish(notification: NotificationRequested): void;
}

export class NotificationService {
  constructor(
    private readonly deps: { publisher: NotificationPublisher; clock: Clock; ids: IdGenerator },
  ) {}

  onCriticalAlert(event: CriticalAlertEvent): NotificationRequested[] {
    const timestamp = this.deps.clock.now().toISOString();
    const notifications = routeCriticalAlert(event.payload).map(
      (routed): NotificationRequested => ({
        eventId: this.deps.ids.next(),
        seniorId: event.seniorId,
        type: 'NotificationRequested',
        timestamp,
        payload: {
          alertId: event.payload.alertId,
          sensorId: null,
          recipientRole: routed.recipientRole,
          priority: routed.priority,
          severity: event.payload.severity,
          reason: event.payload.reason,
          escalationCause: event.payload.escalationCause,
          title: routed.title,
          message: routed.message,
        },
      }),
    );
    for (const notification of notifications) this.deps.publisher.publish(notification);
    return notifications;
  }
}

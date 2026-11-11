// Notifications de capteur (ADR 0012) : un SensorStatusChanged devient une notification par rôle destinataire,
// sans alertId (la notification concerne un capteur). L'API la remet ensuite aux personnes, comme les autres.

import type { NotificationRequested } from '@project/shared-types';
import type { Clock, IdGenerator, NotificationPublisher } from './notification-service.js';
import { routeSensorStatus, type SensorStatusEvent } from './sensor-routing.js';

export class SensorNotificationService {
  constructor(private readonly deps: { publisher: NotificationPublisher; clock: Clock; ids: IdGenerator }) {}

  onSensorStatusChanged(event: SensorStatusEvent): NotificationRequested[] {
    const timestamp = this.deps.clock.now().toISOString();
    const notifications = routeSensorStatus(event.payload).map(
      (routed): NotificationRequested => ({
        eventId: this.deps.ids.next(),
        seniorId: event.seniorId,
        type: 'NotificationRequested',
        timestamp,
        payload: {
          alertId: null,
          sensorId: event.payload.sensorId,
          recipientRole: routed.recipientRole,
          priority: routed.priority,
          severity: 'SYSTEM',
          reason: null,
          escalationCause: null,
          title: routed.title,
          message: routed.message,
        },
      }),
    );
    for (const notification of notifications) this.deps.publisher.publish(notification);
    return notifications;
  }
}

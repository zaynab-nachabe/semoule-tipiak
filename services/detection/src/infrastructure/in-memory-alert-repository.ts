import type { Alert } from '../domain/entities/alert.js';
import type { AlertRepository } from '../domain/repositories/alert-repository.js';

/** État des alertes en mémoire : les alertes closes ne sont pas conservées. */
export class InMemoryAlertRepository implements AlertRepository {
  private readonly alerts = new Map<string, Alert>();

  findActiveAlertsBySeniorId(seniorId: string): Alert[] {
    return [...this.alerts.values()].filter((a) => a.seniorId === seniorId && a.isActive);
  }

  save(alert: Alert): void {
    if (alert.isActive) {
      this.alerts.set(alert.alertId, alert);
    } else {
      this.alerts.delete(alert.alertId);
    }
  }
}

// CorrelationService (DDD §4.5), partie chute (scénario A), avec l'échelle de gravité à 4 niveaux.
//
// FALL_IMPACT (≥ seuil) ─► PreConfirmationRequested (niveau 1)
//   ├─► CANCEL_ALERT, ou séquence de relèvement ─────► PreConfirmationCanceled
//   ├─► HELP_BUTTON ─────────────────────────────────► CriticalAlertGenerated (CRITICAL, SENIOR_CONFIRMED)
//   └─► délai expiré sans relèvement ─────────────────► PreConfirmationTimeoutExpired + CriticalAlertGenerated (WARNING, NO_RESPONSE)
//         ├─► HELP_BUTTON ───────────────────────────► CriticalAlertGenerated (CRITICAL, SENIOR_CONFIRMED)
//         ├─► délai supplémentaire sans relèvement ──► CriticalAlertGenerated (CRITICAL, NO_RECOVERY)
//         └─► séquence de relèvement ────────────────► alerte close, pas de niveau 3
// HELP_BUTTON hors de toute alerte en cours ─────────► CriticalAlertGenerated (CRITICAL, IMMEDIATE)
//
// Les enchaînements suivent docs/format-evenements.md §6 ; les valeurs, FallDetectionPolicy.

import type {
  CancellationCause,
  DomainEvent,
  DomainEventPayloadByType,
  DomainEventType,
  EscalationCause,
  RawSignal,
} from '@project/shared-types';
import { Alert, AlertStatus, type EscalatedSeverity } from '../entities/alert.js';
import type { FallImpactSignal, FallSuspected } from '../events/fall-suspected.js';
import type { AlertRepository } from '../repositories/alert-repository.js';
import { assertValidPolicy, type FallDetectionPolicy } from '../value-objects/fall-detection-policy.js';
import { createPreConfirmation, type PreConfirmation } from '../value-objects/pre-confirmation.js';
import { FALLEN, advanceRecovery, isActivitySignal, type ActivitySignal, type RecoveryProgress } from '../value-objects/recovery-progress.js';
import type { Clock, DomainEventPublisher, IdGenerator, ScheduledTask, Scheduler } from './ports.js';

export interface CorrelationServiceDependencies {
  alerts: AlertRepository;
  publisher: DomainEventPublisher;
  clock: Clock;
  scheduler: Scheduler;
  ids: IdGenerator;
  policy: FallDetectionPolicy;
}

/** Suivi en mémoire d'une alerte de chute ouverte (levée de doute ou niveau 2). */
interface FallTracking {
  readonly impactAt: Date;
  readonly triggeringEventIds: string[];
  readonly preConfirmation: PreConfirmation;
  recovery: RecoveryProgress;
  timer: ScheduledTask;
  /** La décision de fin de levée de doute a déjà été reportée une fois (relèvement en cours). */
  decisionDeferred: boolean;
}

export class CorrelationService {
  private readonly tracked = new Map<string, FallTracking>();

  constructor(private readonly deps: CorrelationServiceDependencies) {
    assertValidPolicy(deps.policy);
  }

  /** Point d'entrée : un signal normalisé reçu sur signals/{seniorId}/{type} (DDD : RawSignalReceived). */
  onRawSignalReceived(signal: RawSignal): void {
    if (signal.type === 'FALL_IMPACT') {
      this.onFallImpact(signal);
    } else if (signal.type === 'CANCEL_ALERT') {
      this.onCancel(signal.seniorId, signal.eventId, signal.payload.alertId);
    } else if (signal.type === 'HELP_BUTTON') {
      this.onHelpButton(signal.seniorId, signal.eventId);
    } else if (isActivitySignal(signal)) {
      this.onActivity(signal);
    }
  }

  private onFallImpact(signal: FallImpactSignal): void {
    if (signal.payload.value < this.deps.policy.minFallImpact) {
      return; // choc mineur
    }
    const open = this.openFor(signal.seniorId);
    if (open.length > 0) {
      // Nouvel impact pendant un incident en cours : même incident, pas de seconde pré-confirmation.
      for (const { tracking } of open) tracking.triggeringEventIds.push(signal.eventId);
      return;
    }
    this.onFallSuspected({ seniorId: signal.seniorId, impact: signal });
  }

  private onFallSuspected(event: FallSuspected): void {
    const now = this.deps.clock.now();
    const alert = Alert.create({ alertId: this.deps.ids.next(), seniorId: event.seniorId, createdAt: now, reason: 'FALL_DETECTED' });
    alert.startPreConfirmation();
    this.deps.alerts.save(alert);

    const preConfirmation = createPreConfirmation(event.seniorId, alert.alertId, now, this.deps.policy.preConfirmationDelayMs);
    this.tracked.set(alert.alertId, {
      impactAt: new Date(event.impact.timestamp),
      triggeringEventIds: [event.impact.eventId],
      preConfirmation,
      recovery: FALLEN,
      timer: this.schedule(preConfirmation.expiresAt, () => this.onPreConfirmationDeadline(event.seniorId, alert.alertId)),
      decisionDeferred: false,
    });

    this.emit('PreConfirmationRequested', event.seniorId, {
      alertId: alert.alertId,
      reason: alert.reason,
      requestedAt: preConfirmation.requestedAt.toISOString(),
      expiresAt: preConfirmation.expiresAt.toISOString(),
      triggeringEventIds: [event.impact.eventId],
    });
  }

  /** « Non, tout va bien » : sans alertId, porte sur toutes les levées de doute en cours. Ignoré après escalade. */
  private onCancel(seniorId: string, cancelEventId: string, alertId: string | undefined): void {
    for (const { alert, tracking } of this.openFor(seniorId)) {
      if (alert.status === AlertStatus.PRE_CONFIRMING && (alertId === undefined || alert.alertId === alertId)) {
        this.closeByRecovery(alert, tracking, 'SENIOR_CANCELED', cancelEventId);
      }
    }
  }

  private onActivity(signal: ActivitySignal): void {
    for (const { alert, tracking } of this.openFor(signal.seniorId)) {
      tracking.recovery = advanceRecovery(tracking.recovery, signal, tracking.impactAt, this.deps.policy.recoveryConfirmationWindowMs);
      if (tracking.recovery.stage === 'RECOVERED') {
        this.closeByRecovery(alert, tracking, 'ACTIVITY_RESUMED', tracking.recovery.confirmingEventId);
      }
    }
  }

  private onHelpButton(seniorId: string, helpEventId: string): void {
    const open = this.openFor(seniorId);
    if (open.length > 0) {
      // Pendant une levée de doute ou après une alerte de niveau 2 : la personne confirme l'incident.
      for (const { alert, tracking } of open) {
        this.stopTracking(alert.alertId, tracking);
        tracking.triggeringEventIds.push(helpEventId);
        if (alert.status === AlertStatus.ESCALATED) {
          alert.raiseToCritical();
          this.deps.alerts.save(alert);
          this.publishCriticalAlert(alert, 'SENIOR_CONFIRMED', tracking.triggeringEventIds);
        } else {
          this.escalate(alert, 'CRITICAL', 'SENIOR_CONFIRMED', tracking.triggeringEventIds);
        }
      }
      return;
    }
    // Demande d'aide spontanée : alerte critique immédiate, sans pré-confirmation.
    const alert = Alert.create({ alertId: this.deps.ids.next(), seniorId, createdAt: this.deps.clock.now(), reason: 'HELP_REQUESTED' });
    this.escalate(alert, 'CRITICAL', 'IMMEDIATE', [helpEventId]);
  }

  private onPreConfirmationDeadline(seniorId: string, alertId: string): void {
    const tracking = this.tracked.get(alertId);
    const alert = this.findOpen(seniorId, alertId);
    if (!tracking || !alert || alert.status !== AlertStatus.PRE_CONFIRMING) {
      return; // déjà annulée ou confirmée entre-temps
    }
    if (tracking.recovery.stage === 'ACTIVE' && !tracking.decisionDeferred) {
      // La personne a commencé à bouger : on lui laisse le délai de confirmation avant d'alerter.
      const deadline = new Date(tracking.recovery.activityAt.getTime() + this.deps.policy.recoveryConfirmationWindowMs);
      if (deadline.getTime() > this.deps.clock.now().getTime()) {
        tracking.decisionDeferred = true;
        tracking.timer = this.schedule(deadline, () => this.onPreConfirmationDeadline(seniorId, alertId));
        return;
      }
    }

    this.emit('PreConfirmationTimeoutExpired', seniorId, {
      alertId,
      requestedAt: tracking.preConfirmation.requestedAt.toISOString(),
      expiresAt: tracking.preConfirmation.expiresAt.toISOString(),
    });
    this.escalate(alert, 'WARNING', 'NO_RESPONSE', tracking.triggeringEventIds);
    const criticalAt = new Date(this.deps.clock.now().getTime() + this.deps.policy.criticalEscalationDelayMs);
    tracking.timer = this.schedule(criticalAt, () => this.onCriticalDeadline(seniorId, alertId));
  }

  /** Niveau 2 resté sans relèvement : passage au niveau 3. */
  private onCriticalDeadline(seniorId: string, alertId: string): void {
    const tracking = this.tracked.get(alertId);
    const alert = this.findOpen(seniorId, alertId);
    if (!tracking || !alert || alert.severity !== 'WARNING') {
      return;
    }
    this.tracked.delete(alertId);
    alert.raiseToCritical();
    this.deps.alerts.save(alert);
    this.publishCriticalAlert(alert, 'NO_RECOVERY', tracking.triggeringEventIds);
  }

  /**
   * La personne a annulé ou s'est relevée. Pendant la levée de doute, l'annulation est publiée.
   * Après une alerte de niveau 2, l'alerte est close sans événement : le passage au niveau 3 est
   * simplement évité (limite connue : la famille n'est pas informée du relèvement).
   */
  private closeByRecovery(alert: Alert, tracking: FallTracking, cause: CancellationCause, triggeringEventId: string): void {
    const wasPreConfirming = alert.status === AlertStatus.PRE_CONFIRMING;
    this.stopTracking(alert.alertId, tracking);
    alert.resolve(cause);
    this.deps.alerts.save(alert);
    if (wasPreConfirming) {
      this.emit('PreConfirmationCanceled', alert.seniorId, { alertId: alert.alertId, cause, triggeringEventId });
    }
  }

  private escalate(alert: Alert, severity: EscalatedSeverity, cause: EscalationCause, triggeringEventIds: readonly string[]): void {
    alert.escalate(severity);
    this.deps.alerts.save(alert);
    this.publishCriticalAlert(alert, cause, triggeringEventIds);
  }

  private publishCriticalAlert(alert: Alert, escalationCause: EscalationCause, triggeringEventIds: readonly string[]): void {
    if (alert.severity === null) throw new Error(`Alert ${alert.alertId} : gravité absente`);
    this.emit('CriticalAlertGenerated', alert.seniorId, {
      alertId: alert.alertId,
      reason: alert.reason,
      severity: alert.severity,
      escalationCause,
      triggeringEventIds: [...triggeringEventIds],
    });
  }

  private stopTracking(alertId: string, tracking: FallTracking): void {
    tracking.timer.cancel();
    this.tracked.delete(alertId);
  }

  /** Alertes de chute du senior encore suivies (levée de doute ou niveau 2). */
  private openFor(seniorId: string): { alert: Alert; tracking: FallTracking }[] {
    const result: { alert: Alert; tracking: FallTracking }[] = [];
    for (const alert of this.deps.alerts.findActiveAlertsBySeniorId(seniorId)) {
      const tracking = this.tracked.get(alert.alertId);
      if (tracking) result.push({ alert, tracking });
    }
    return result;
  }

  private findOpen(seniorId: string, alertId: string): Alert | undefined {
    return this.deps.alerts.findActiveAlertsBySeniorId(seniorId).find((a) => a.alertId === alertId);
  }

  private schedule(at: Date, task: () => void): ScheduledTask {
    return this.deps.scheduler.schedule(at, task);
  }

  private emit<T extends DomainEventType>(type: T, seniorId: string, payload: DomainEventPayloadByType[T]): void {
    const event = {
      eventId: this.deps.ids.next(),
      seniorId,
      type,
      timestamp: this.deps.clock.now().toISOString(),
      payload,
    } as DomainEvent;
    this.deps.publisher.publish(event);
  }
}

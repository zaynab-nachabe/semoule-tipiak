// CorrelationService (DDD §4.5), partie chute (scénario A).
//
// FALL_IMPACT ─► FallSuspected ─► PreConfirmationRequested ─┬─► CANCEL_ALERT ─────────► PreConfirmationCanceled (SENIOR_CANCELED)
//                                                           ├─► reprise d'activité ───► PreConfirmationCanceled (ACTIVITY_RESUMED)
//                                                           ├─► HELP_BUTTON ──────────► CriticalAlertGenerated (SENIOR_CONFIRMED)
//                                                           └─► minuteur expiré ──────► PreConfirmationTimeoutExpired + CriticalAlertGenerated (NO_RESPONSE)
// HELP_BUTTON sans pré-confirmation en cours ───────────────────────────────────────► CriticalAlertGenerated (HELP_REQUESTED, IMMEDIATE)
//
// Les enchaînements suivent docs/format-evenements.md §6.

import type {
  CancellationCause,
  DomainEvent,
  DomainEventPayloadByType,
  DomainEventType,
  EscalationCause,
  RawSignal,
  Severity,
} from '@project/shared-types';
import { Alert, AlertStatus } from '../entities/alert.js';
import type { FallSuspected, FallImpactSignal } from '../events/fall-suspected.js';
import type { AlertRepository } from '../repositories/alert-repository.js';
import { assertValidPolicy, type FallDetectionPolicy } from '../value-objects/fall-detection-policy.js';
import { createPreConfirmation, type PreConfirmation } from '../value-objects/pre-confirmation.js';
import type { Clock, DomainEventPublisher, IdGenerator, ScheduledTask, Scheduler } from './ports.js';

export interface CorrelationServiceDependencies {
  alerts: AlertRepository;
  publisher: DomainEventPublisher;
  clock: Clock;
  scheduler: Scheduler;
  ids: IdGenerator;
  policy: FallDetectionPolicy;
}

/** Levée de doute en cours, gardée en mémoire. */
interface OpenPreConfirmation {
  readonly preConfirmation: PreConfirmation;
  /** Horodatage de l'impact : seule une activité postérieure prouve que la personne s'est relevée. */
  readonly impactAt: Date;
  readonly triggeringEventIds: string[];
  readonly timeout: ScheduledTask;
}

export class CorrelationService {
  private readonly openPreConfirmations = new Map<string, OpenPreConfirmation>();

  constructor(private readonly deps: CorrelationServiceDependencies) {
    assertValidPolicy(deps.policy);
  }

  /** Point d'entrée : un signal normalisé reçu sur signals/{seniorId}/{type} (DDD : RawSignalReceived). */
  onRawSignalReceived(signal: RawSignal): void {
    switch (signal.type) {
      case 'FALL_IMPACT':
        this.onFallImpact(signal);
        return;
      case 'CANCEL_ALERT':
        this.onCancel(signal.seniorId, signal.eventId, signal.payload.alertId);
        return;
      case 'HELP_BUTTON':
        this.onHelpButton(signal.seniorId, signal.eventId);
        return;
      default:
        if (this.deps.policy.activityResumedSignalTypes.includes(signal.type)) {
          this.onActivity(signal.seniorId, signal.eventId, new Date(signal.timestamp));
        }
    }
  }

  private onFallImpact(signal: FallImpactSignal): void {
    if (signal.payload.value < this.deps.policy.minFallImpact) {
      return; // choc mineur
    }
    const open = this.openFor(signal.seniorId);
    if (open.length > 0) {
      // Nouvel impact pendant une levée de doute : même incident, pas de seconde pré-confirmation.
      for (const { state } of open) state.triggeringEventIds.push(signal.eventId);
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
    const timeout = this.deps.scheduler.schedule(preConfirmation.expiresAt, () =>
      this.onPreConfirmationTimeout(event.seniorId, alert.alertId),
    );
    this.openPreConfirmations.set(alert.alertId, {
      preConfirmation,
      impactAt: new Date(event.impact.timestamp),
      triggeringEventIds: [event.impact.eventId],
      timeout,
    });

    this.emit('PreConfirmationRequested', event.seniorId, {
      alertId: alert.alertId,
      reason: alert.reason,
      requestedAt: preConfirmation.requestedAt.toISOString(),
      expiresAt: preConfirmation.expiresAt.toISOString(),
      triggeringEventIds: [event.impact.eventId],
    });
  }

  /** « Non, tout va bien » : sans alertId, l'annulation porte sur toutes les levées de doute en cours. */
  private onCancel(seniorId: string, cancelEventId: string, alertId: string | undefined): void {
    for (const { alert } of this.openFor(seniorId)) {
      if (alertId === undefined || alert.alertId === alertId) {
        this.cancelPreConfirmation(alert, 'SENIOR_CANCELED', cancelEventId);
      }
    }
  }

  private onActivity(seniorId: string, activityEventId: string, activityAt: Date): void {
    for (const { alert, state } of this.openFor(seniorId)) {
      if (activityAt.getTime() > state.impactAt.getTime()) {
        this.cancelPreConfirmation(alert, 'ACTIVITY_RESUMED', activityEventId);
      }
    }
  }

  private onHelpButton(seniorId: string, helpEventId: string): void {
    const open = this.openFor(seniorId);
    if (open.length > 0) {
      // Pendant une levée de doute, le bouton d'aide confirme l'incident.
      for (const { alert, state } of open) {
        state.timeout.cancel();
        this.openPreConfirmations.delete(alert.alertId);
        state.triggeringEventIds.push(helpEventId);
        this.escalate(alert, this.deps.policy.fallAlertSeverity, 'SENIOR_CONFIRMED', state.triggeringEventIds);
      }
      return;
    }
    // Demande d'aide spontanée : alerte critique immédiate, sans pré-confirmation.
    const alert = Alert.create({
      alertId: this.deps.ids.next(),
      seniorId,
      createdAt: this.deps.clock.now(),
      reason: 'HELP_REQUESTED',
    });
    this.escalate(alert, this.deps.policy.helpRequestSeverity, 'IMMEDIATE', [helpEventId]);
  }

  private onPreConfirmationTimeout(seniorId: string, alertId: string): void {
    const state = this.openPreConfirmations.get(alertId);
    const alert = this.deps.alerts.findActiveAlertsBySeniorId(seniorId).find((a) => a.alertId === alertId);
    if (!state || !alert || alert.status !== AlertStatus.PRE_CONFIRMING) {
      return; // déjà annulée ou confirmée entre-temps
    }
    this.openPreConfirmations.delete(alertId);
    this.emit('PreConfirmationTimeoutExpired', seniorId, {
      alertId,
      requestedAt: state.preConfirmation.requestedAt.toISOString(),
      expiresAt: state.preConfirmation.expiresAt.toISOString(),
    });
    this.escalate(alert, this.deps.policy.fallAlertSeverity, 'NO_RESPONSE', state.triggeringEventIds);
  }

  private cancelPreConfirmation(alert: Alert, cause: CancellationCause, triggeringEventId: string): void {
    const state = this.openPreConfirmations.get(alert.alertId);
    state?.timeout.cancel();
    this.openPreConfirmations.delete(alert.alertId);
    alert.resolve(cause);
    this.deps.alerts.save(alert);
    this.emit('PreConfirmationCanceled', alert.seniorId, { alertId: alert.alertId, cause, triggeringEventId });
  }

  private escalate(alert: Alert, severity: Severity, escalationCause: EscalationCause, triggeringEventIds: readonly string[]): void {
    alert.escalate();
    this.deps.alerts.save(alert);
    this.emit('CriticalAlertGenerated', alert.seniorId, {
      alertId: alert.alertId,
      reason: alert.reason,
      severity,
      escalationCause,
      triggeringEventIds: [...triggeringEventIds],
    });
  }

  /** Alertes du senior en cours de levée de doute, avec leur état en mémoire. */
  private openFor(seniorId: string): { alert: Alert; state: OpenPreConfirmation }[] {
    const result: { alert: Alert; state: OpenPreConfirmation }[] = [];
    for (const alert of this.deps.alerts.findActiveAlertsBySeniorId(seniorId)) {
      const state = this.openPreConfirmations.get(alert.alertId);
      if (alert.status === AlertStatus.PRE_CONFIRMING && state) result.push({ alert, state });
    }
    return result;
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

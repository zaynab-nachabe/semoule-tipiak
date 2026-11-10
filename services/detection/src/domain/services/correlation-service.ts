// CorrelationService (DDD §4.5) : chute (scénario A) et inactivité prolongée (scénario B), avec
// l'échelle de gravité à 4 niveaux.
//
// Chute (ADR 0003 à 0005)
// FALL_IMPACT (≥ seuil) ─► PreConfirmationRequested (niveau 1)
//   ├─► CANCEL_ALERT, ou séquence de relèvement ─────► PreConfirmationCanceled
//   ├─► HELP_BUTTON ─────────────────────────────────► CriticalAlertGenerated (CRITICAL, SENIOR_CONFIRMED)
//   └─► délai expiré sans relèvement ─────────────────► PreConfirmationTimeoutExpired + CriticalAlertGenerated (WARNING, NO_RESPONSE)
//         ├─► HELP_BUTTON ───────────────────────────► CriticalAlertGenerated (CRITICAL, SENIOR_CONFIRMED)
//         ├─► délai supplémentaire sans relèvement ──► CriticalAlertGenerated (CRITICAL, NO_RECOVERY)
//         └─► séquence de relèvement ────────────────► alerte close, pas de niveau 3
// HELP_BUTTON hors de toute alerte en cours ─────────► CriticalAlertGenerated (CRITICAL, IMMEDIATE)
//
// Inactivité (ADR 0010) : vérification périodique du temps sans activité contre le seuil du profil
// plus d'activité depuis le seuil ─► PreConfirmationRequested (PROLONGED_INACTIVITY)
//   ├─► CANCEL_ALERT, ou une activité ───────────────► PreConfirmationCanceled
//   ├─► HELP_BUTTON ─────────────────────────────────► CriticalAlertGenerated (CRITICAL, SENIOR_CONFIRMED)
//   └─► délai expiré ─► PreConfirmationTimeoutExpired, puis selon la fréquence cardiaque :
//         ├─ récente et normale ─► CriticalAlertGenerated (WARNING, NO_RESPONSE), puis NO_RECOVERY comme la chute
//         └─ absente ou anormale ► CriticalAlertGenerated (CRITICAL, NO_HEART_SIGNAL)
//
// Les enchaînements suivent docs/format-evenements.md §6 et §10.

import type {
  CancellationCause,
  DomainEvent,
  DomainEventPayloadByType,
  DomainEventType,
  EscalationCause,
  RawSignal,
} from '@project/shared-types';
import type { ActivityProfile } from '../aggregates/activity-profile.js';
import { Alert, AlertStatus, type EscalatedSeverity } from '../entities/alert.js';
import type { FallImpactSignal, FallSuspected } from '../events/fall-suspected.js';
import type { ActivityProfileRepository } from '../repositories/activity-profile-repository.js';
import type { AlertRepository } from '../repositories/alert-repository.js';
import { assertValidPolicy, type FallDetectionPolicy } from '../value-objects/fall-detection-policy.js';
import { assertValidInactivityPolicy, hasReassuringHeartRate, type InactivityPolicy } from '../value-objects/inactivity-policy.js';
import { createPreConfirmation, type PreConfirmation } from '../value-objects/pre-confirmation.js';
import { FALLEN, advanceRecovery, isActivitySignal, type ActivitySignal, type RecoveryProgress } from '../value-objects/recovery-progress.js';
import type { Clock, DomainEventPublisher, IdGenerator, ScheduledTask, Scheduler } from './ports.js';

/** Emplacement de la bande de pression du lit dans le registre des capteurs (services/ingestion). */
export const BED_LOCATION = 'lit';

export interface CorrelationServiceDependencies {
  alerts: AlertRepository;
  profiles: ActivityProfileRepository;
  publisher: DomainEventPublisher;
  clock: Clock;
  scheduler: Scheduler;
  ids: IdGenerator;
  policy: FallDetectionPolicy;
  inactivityPolicy: InactivityPolicy;
}

/** Suivi en mémoire d'une alerte ouverte (levée de doute ou niveau 2). */
interface Tracking {
  readonly kind: 'FALL' | 'INACTIVITY';
  /** Chute : horodatage de l'impact (les signaux antérieurs ne comptent pas pour le relèvement). */
  readonly impactAt: Date;
  readonly triggeringEventIds: string[];
  readonly preConfirmation: PreConfirmation;
  recovery: RecoveryProgress;
  timer: ScheduledTask;
  /** La décision de fin de levée de doute a déjà été reportée une fois (relèvement en cours). */
  decisionDeferred: boolean;
}

/** DDD : ActivityHistory. Ce que la détection retient des derniers signaux d'un senior. */
interface SeniorActivity {
  lastActivityAt: Date;
  lastActivityEventId: string | null;
  /** Bande de pression du lit appuyée : la personne se repose. */
  inBed: boolean;
  lastHeartRate: { value: number; at: Date } | null;
  /** Début du dernier incident (chute, aide, inactivité) : pas de nouvelle alerte d'inactivité sans activité depuis. */
  lastIncidentAt: Date | null;
}

export class CorrelationService {
  private readonly tracked = new Map<string, Tracking>();
  private readonly activity = new Map<string, SeniorActivity>();
  /** Profils reçus par message depuis le démarrage : le chargement initial ne les écrase pas. */
  private readonly updatedByMessage = new Set<string>();

  constructor(private readonly deps: CorrelationServiceDependencies) {
    assertValidPolicy(deps.policy);
    assertValidInactivityPolicy(deps.inactivityPolicy);
  }

  /** Point d'entrée : un signal normalisé reçu sur signals/{seniorId}/{type} (DDD : RawSignalReceived). */
  onRawSignalReceived(signal: RawSignal): void {
    this.remember(signal);
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

  // ─── Profils d'activité (ADR 0010) ───

  /** Chargement initial depuis l'API. Un profil déjà reçu par message depuis le démarrage est plus récent. */
  loadProfiles(profiles: readonly ActivityProfile[]): void {
    for (const profile of profiles) {
      if (!this.updatedByMessage.has(profile.seniorId)) this.saveProfile(profile);
    }
  }

  /** Profil modifié par l'équipe médicale (message profiles/{seniorId}). */
  onActivityProfileUpdated(profile: ActivityProfile): void {
    this.updatedByMessage.add(profile.seniorId);
    this.saveProfile(profile);
  }

  /** Lance la vérification périodique des seuils d'inactivité ; renvoie de quoi l'arrêter. */
  startInactivityMonitoring(): ScheduledTask {
    let current: ScheduledTask;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      this.checkInactivity();
      current = this.schedule(this.inMs(this.deps.inactivityPolicy.checkIntervalMs), tick);
    };
    current = this.schedule(this.inMs(this.deps.inactivityPolicy.checkIntervalMs), tick);
    return {
      cancel: () => {
        stopped = true;
        current.cancel();
      },
    };
  }

  /** Compare, pour chaque senior qui a un profil, le temps sans activité au seuil applicable. */
  checkInactivity(): void {
    const now = this.deps.clock.now();
    for (const profile of this.deps.profiles.all()) {
      const history = this.activityOf(profile.seniorId);
      if (this.openFor(profile.seniorId).length > 0) continue; // une alerte à la fois
      if (history.lastIncidentAt && history.lastActivityAt.getTime() <= history.lastIncidentAt.getTime()) continue; // déjà signalée
      if (profile.evaluateInactivity(history.lastActivityAt, now, history.inBed)) {
        this.onInactivitySuspected(profile.seniorId, history);
      }
    }
  }

  private saveProfile(profile: ActivityProfile): void {
    this.deps.profiles.save(profile);
    this.activityOf(profile.seniorId); // le compte commence au plus tard maintenant
  }

  // ─── Mémoire des derniers signaux ───

  private activityOf(seniorId: string): SeniorActivity {
    let history = this.activity.get(seniorId);
    if (!history) {
      // Aucun signal connu (démarrage, nouveau profil) : on compte à partir de maintenant.
      history = { lastActivityAt: this.deps.clock.now(), lastActivityEventId: null, inBed: false, lastHeartRate: null, lastIncidentAt: null };
      this.activity.set(seniorId, history);
    }
    return history;
  }

  private remember(signal: RawSignal): void {
    const history = this.activityOf(signal.seniorId);
    const at = new Date(signal.timestamp);
    if (isActivitySignal(signal) || signal.type === 'CANCEL_ALERT') {
      // Bouger, ou répondre « tout va bien », prouve que la personne n'est pas inactive.
      if (at.getTime() >= history.lastActivityAt.getTime()) {
        history.lastActivityAt = at;
        history.lastActivityEventId = signal.eventId;
      }
      if (signal.type === 'PRESSURE_PLATE' && signal.payload.location === BED_LOCATION) {
        history.inBed = signal.payload.state === 'PRESSED';
      }
    } else if (signal.type === 'HEART_RATE') {
      if (!history.lastHeartRate || at.getTime() >= history.lastHeartRate.at.getTime()) {
        history.lastHeartRate = { value: signal.payload.value, at };
      }
    }
  }

  private markIncident(seniorId: string): void {
    this.activityOf(seniorId).lastIncidentAt = this.deps.clock.now();
  }

  // ─── Chute ───

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
    this.startPreConfirmation(event.seniorId, 'FALL', 'FALL_DETECTED', [event.impact.eventId], new Date(event.impact.timestamp));
  }

  // ─── Inactivité ───

  private onInactivitySuspected(seniorId: string, history: SeniorActivity): void {
    const triggering = history.lastActivityEventId ? [history.lastActivityEventId] : [];
    this.startPreConfirmation(seniorId, 'INACTIVITY', 'PROLONGED_INACTIVITY', triggering, history.lastActivityAt);
  }

  // ─── Levée de doute (commune) ───

  private startPreConfirmation(
    seniorId: string,
    kind: Tracking['kind'],
    reason: 'FALL_DETECTED' | 'PROLONGED_INACTIVITY',
    triggeringEventIds: string[],
    since: Date,
  ): void {
    const now = this.deps.clock.now();
    const alert = Alert.create({ alertId: this.deps.ids.next(), seniorId, createdAt: now, reason });
    alert.startPreConfirmation();
    this.deps.alerts.save(alert);
    this.markIncident(seniorId);

    const preConfirmation = createPreConfirmation(seniorId, alert.alertId, now, this.deps.policy.preConfirmationDelayMs);
    this.tracked.set(alert.alertId, {
      kind,
      impactAt: since,
      triggeringEventIds: [...triggeringEventIds],
      preConfirmation,
      recovery: FALLEN,
      timer: this.schedule(preConfirmation.expiresAt, () => this.onPreConfirmationDeadline(seniorId, alert.alertId)),
      decisionDeferred: false,
    });

    this.emit('PreConfirmationRequested', seniorId, {
      alertId: alert.alertId,
      reason,
      requestedAt: preConfirmation.requestedAt.toISOString(),
      expiresAt: preConfirmation.expiresAt.toISOString(),
      triggeringEventIds: [...triggeringEventIds],
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
      if (tracking.kind === 'INACTIVITY') {
        // Une seule activité suffit : la personne bouge, elle n'est pas inactive.
        if (new Date(signal.timestamp).getTime() > tracking.impactAt.getTime()) {
          this.closeByRecovery(alert, tracking, 'ACTIVITY_RESUMED', signal.eventId);
        }
        continue;
      }
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
    this.markIncident(seniorId);
    this.escalate(alert, 'CRITICAL', 'IMMEDIATE', [helpEventId]);
  }

  private onPreConfirmationDeadline(seniorId: string, alertId: string): void {
    const tracking = this.tracked.get(alertId);
    const alert = this.findOpen(seniorId, alertId);
    if (!tracking || !alert || alert.status !== AlertStatus.PRE_CONFIRMING) {
      return; // déjà annulée ou confirmée entre-temps
    }
    if (tracking.kind === 'FALL' && tracking.recovery.stage === 'ACTIVE' && !tracking.decisionDeferred) {
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

    // Inactivité (DDD scénario B, étape 5) : sans fréquence cardiaque rassurante, urgence directe.
    if (tracking.kind === 'INACTIVITY') {
      const heartRate = this.activityOf(seniorId).lastHeartRate;
      if (!hasReassuringHeartRate(heartRate, this.deps.clock.now(), this.deps.inactivityPolicy)) {
        this.tracked.delete(alertId);
        this.escalate(alert, 'CRITICAL', 'NO_HEART_SIGNAL', tracking.triggeringEventIds);
        return;
      }
    }

    this.escalate(alert, 'WARNING', 'NO_RESPONSE', tracking.triggeringEventIds);
    tracking.timer = this.schedule(this.inMs(this.deps.policy.criticalEscalationDelayMs), () => this.onCriticalDeadline(seniorId, alertId));
  }

  /** Niveau 2 resté sans relèvement (chute) ni activité (inactivité) : passage au niveau 3. */
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
   * La personne a annulé, s'est relevée ou a bougé. Pendant la levée de doute, l'annulation est publiée.
   * Après une alerte de niveau 2, l'alerte est close sans événement : le passage au niveau 3 est
   * simplement évité (limite connue : la famille n'est pas informée du relèvement).
   */
  private closeByRecovery(alert: Alert, tracking: Tracking, cause: CancellationCause, triggeringEventId: string): void {
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

  private stopTracking(alertId: string, tracking: Tracking): void {
    tracking.timer.cancel();
    this.tracked.delete(alertId);
  }

  /** Alertes du senior encore suivies (levée de doute ou niveau 2). */
  private openFor(seniorId: string): { alert: Alert; tracking: Tracking }[] {
    const result: { alert: Alert; tracking: Tracking }[] = [];
    for (const alert of this.deps.alerts.findActiveAlertsBySeniorId(seniorId)) {
      const tracking = this.tracked.get(alert.alertId);
      if (tracking) result.push({ alert, tracking });
    }
    return result;
  }

  private findOpen(seniorId: string, alertId: string): Alert | undefined {
    return this.deps.alerts.findActiveAlertsBySeniorId(seniorId).find((a) => a.alertId === alertId);
  }

  private inMs(ms: number): Date {
    return new Date(this.deps.clock.now().getTime() + ms);
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

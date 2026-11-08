// Entité Alert (DDD §4.2) : identité stable, cycle de vie
// PENDING -> PRE_CONFIRMING -> ESCALATED (WARNING -> CRITICAL) | RESOLVED.

import type { AlertReason, CancellationCause, Severity } from '@project/shared-types';

export const AlertStatus = {
  PENDING: 'PENDING',
  PRE_CONFIRMING: 'PRE_CONFIRMING',
  ESCALATED: 'ESCALATED',
  RESOLVED: 'RESOLVED',
} as const;
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];

/** Gravités possibles d'une alerte escaladée (niveaux 2 et 3 de l'échelle, docs/format-evenements.md §6). */
export type EscalatedSeverity = Extract<Severity, 'WARNING' | 'CRITICAL'>;

export interface NewAlert {
  alertId: string;
  seniorId: string;
  createdAt: Date;
  reason: AlertReason;
}

export class Alert {
  readonly alertId: string;
  readonly seniorId: string;
  readonly createdAt: Date;
  readonly reason: AlertReason;
  private currentStatus: AlertStatus = AlertStatus.PENDING;
  private currentSeverity: EscalatedSeverity | null = null;
  private currentResolutionReason: CancellationCause | null = null;

  private constructor(props: NewAlert) {
    this.alertId = props.alertId;
    this.seniorId = props.seniorId;
    this.createdAt = props.createdAt;
    this.reason = props.reason;
  }

  static create(props: NewAlert): Alert {
    return new Alert(props);
  }

  get status(): AlertStatus {
    return this.currentStatus;
  }

  /** Gravité une fois l'alerte escaladée ; null avant. */
  get severity(): EscalatedSeverity | null {
    return this.currentSeverity;
  }

  get resolutionReason(): CancellationCause | null {
    return this.currentResolutionReason;
  }

  /**
   * Une alerte active peut encore évoluer : en attente, en levée de doute,
   * ou escaladée au niveau WARNING (elle peut encore passer CRITICAL).
   */
  get isActive(): boolean {
    return (
      this.currentStatus === AlertStatus.PENDING ||
      this.currentStatus === AlertStatus.PRE_CONFIRMING ||
      (this.currentStatus === AlertStatus.ESCALATED && this.currentSeverity === 'WARNING')
    );
  }

  /** Levée de doute en cours auprès du senior. */
  startPreConfirmation(): void {
    this.assertStatus([AlertStatus.PENDING], 'startPreConfirmation');
    this.currentStatus = AlertStatus.PRE_CONFIRMING;
  }

  /** Passe en alerte avérée (DDD : escalate()), au niveau WARNING ou CRITICAL. */
  escalate(severity: EscalatedSeverity): void {
    this.assertStatus([AlertStatus.PENDING, AlertStatus.PRE_CONFIRMING], 'escalate');
    this.currentStatus = AlertStatus.ESCALATED;
    this.currentSeverity = severity;
  }

  /** Niveau 2 -> niveau 3. */
  raiseToCritical(): void {
    if (this.currentStatus !== AlertStatus.ESCALATED || this.currentSeverity !== 'WARNING') {
      throw new Error(`Alert ${this.alertId} : raiseToCritical() impossible depuis ${this.currentStatus}/${this.currentSeverity ?? '-'}`);
    }
    this.currentSeverity = 'CRITICAL';
  }

  /**
   * Clôture l'alerte (DDD : resolve(resolutionReason)) : pendant la levée de doute, ou après une
   * alerte de niveau 2 si la personne s'est relevée. Une alerte de niveau 3 ne se clôt pas ici.
   */
  resolve(resolutionReason: CancellationCause): void {
    if (!this.isActive) {
      throw new Error(`Alert ${this.alertId} : resolve() impossible depuis ${this.currentStatus}/${this.currentSeverity ?? '-'}`);
    }
    this.currentStatus = AlertStatus.RESOLVED;
    this.currentResolutionReason = resolutionReason;
  }

  private assertStatus(allowed: readonly AlertStatus[], action: string): void {
    if (!allowed.includes(this.currentStatus)) {
      throw new Error(`Alert ${this.alertId} : ${action}() impossible depuis le statut ${this.currentStatus}`);
    }
  }
}

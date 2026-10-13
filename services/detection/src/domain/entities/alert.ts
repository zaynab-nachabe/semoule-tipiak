// Entité Alert (DDD §4.2) : identité stable, cycle de vie PENDING -> PRE_CONFIRMING -> ESCALATED | RESOLVED.

import type { AlertReason, CancellationCause } from '@project/shared-types';

export const AlertStatus = {
  PENDING: 'PENDING',
  PRE_CONFIRMING: 'PRE_CONFIRMING',
  ESCALATED: 'ESCALATED',
  RESOLVED: 'RESOLVED',
} as const;
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];

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

  get resolutionReason(): CancellationCause | null {
    return this.currentResolutionReason;
  }

  /** Une alerte active peut encore évoluer (être escaladée ou résolue). */
  get isActive(): boolean {
    return this.currentStatus === AlertStatus.PENDING || this.currentStatus === AlertStatus.PRE_CONFIRMING;
  }

  /** Levée de doute en cours auprès du senior. */
  startPreConfirmation(): void {
    this.assertStatus([AlertStatus.PENDING], 'startPreConfirmation');
    this.currentStatus = AlertStatus.PRE_CONFIRMING;
  }

  /** Passe en alerte critique (DDD : escalate()). */
  escalate(): void {
    this.assertStatus([AlertStatus.PENDING, AlertStatus.PRE_CONFIRMING], 'escalate');
    this.currentStatus = AlertStatus.ESCALATED;
  }

  /** Clôture l'alerte sans escalade (DDD : resolve(resolutionReason)). */
  resolve(resolutionReason: CancellationCause): void {
    this.assertStatus([AlertStatus.PENDING, AlertStatus.PRE_CONFIRMING], 'resolve');
    this.currentStatus = AlertStatus.RESOLVED;
    this.currentResolutionReason = resolutionReason;
  }

  private assertStatus(allowed: readonly AlertStatus[], action: string): void {
    if (!allowed.includes(this.currentStatus)) {
      throw new Error(`Alert ${this.alertId} : ${action}() impossible depuis le statut ${this.currentStatus}`);
    }
  }
}

import { describe, expect, it } from 'vitest';
import { Alert, AlertStatus } from '../src/domain/entities/alert.js';

const newAlert = () =>
  Alert.create({ alertId: 'alert-1', seniorId: 'senior-001', createdAt: new Date('2026-01-15T14:32:08.000Z'), reason: 'FALL_DETECTED' });

describe('Alert (DDD §4.2)', () => {
  it('naît au statut PENDING', () => {
    expect(newAlert().status).toBe(AlertStatus.PENDING);
  });

  it('PENDING -> PRE_CONFIRMING -> ESCALATED', () => {
    const alert = newAlert();
    alert.startPreConfirmation();
    expect(alert.status).toBe(AlertStatus.PRE_CONFIRMING);
    alert.escalate();
    expect(alert.status).toBe(AlertStatus.ESCALATED);
    expect(alert.isActive).toBe(false);
  });

  it('PRE_CONFIRMING -> RESOLVED garde le motif de résolution', () => {
    const alert = newAlert();
    alert.startPreConfirmation();
    alert.resolve('SENIOR_CANCELED');
    expect(alert.status).toBe(AlertStatus.RESOLVED);
    expect(alert.resolutionReason).toBe('SENIOR_CANCELED');
  });

  it('une alerte escaladée ne peut plus être résolue', () => {
    const alert = newAlert();
    alert.escalate();
    expect(() => alert.resolve('SENIOR_CANCELED')).toThrow(/ESCALATED/);
  });

  it('une alerte résolue ne peut plus être escaladée', () => {
    const alert = newAlert();
    alert.resolve('ACTIVITY_RESUMED');
    expect(() => alert.escalate()).toThrow(/RESOLVED/);
  });

  it('la pré-confirmation ne démarre qu\'une fois', () => {
    const alert = newAlert();
    alert.startPreConfirmation();
    expect(() => alert.startPreConfirmation()).toThrow(/PRE_CONFIRMING/);
  });
});

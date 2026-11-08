import { describe, expect, it } from 'vitest';
import { Alert, AlertStatus } from '../src/domain/entities/alert.js';

const newAlert = () =>
  Alert.create({ alertId: 'alert-1', seniorId: 'senior-001', createdAt: new Date('2026-01-15T14:32:08.000Z'), reason: 'FALL_DETECTED' });

describe('Alert (DDD §4.2)', () => {
  it('naît au statut PENDING, sans gravité', () => {
    const alert = newAlert();
    expect(alert.status).toBe(AlertStatus.PENDING);
    expect(alert.severity).toBeNull();
    expect(alert.isActive).toBe(true);
  });

  it('PENDING -> PRE_CONFIRMING -> ESCALATED/WARNING reste active (peut encore passer CRITICAL)', () => {
    const alert = newAlert();
    alert.startPreConfirmation();
    alert.escalate('WARNING');
    expect([alert.status, alert.severity, alert.isActive]).toEqual([AlertStatus.ESCALATED, 'WARNING', true]);
  });

  it('WARNING -> CRITICAL, puis l\'alerte n\'évolue plus', () => {
    const alert = newAlert();
    alert.escalate('WARNING');
    alert.raiseToCritical();
    expect([alert.severity, alert.isActive]).toEqual(['CRITICAL', false]);
    expect(() => alert.raiseToCritical()).toThrow();
    expect(() => alert.resolve('ACTIVITY_RESUMED')).toThrow();
  });

  it('PRE_CONFIRMING -> RESOLVED garde le motif de résolution', () => {
    const alert = newAlert();
    alert.startPreConfirmation();
    alert.resolve('SENIOR_CANCELED');
    expect([alert.status, alert.resolutionReason, alert.isActive]).toEqual([AlertStatus.RESOLVED, 'SENIOR_CANCELED', false]);
  });

  it('WARNING -> RESOLVED quand la personne s\'est relevée', () => {
    const alert = newAlert();
    alert.escalate('WARNING');
    alert.resolve('ACTIVITY_RESUMED');
    expect(alert.status).toBe(AlertStatus.RESOLVED);
  });

  it('une alerte CRITICAL d\'emblée ne peut être ni résolue ni rehaussée', () => {
    const alert = newAlert();
    alert.escalate('CRITICAL');
    expect(() => alert.resolve('SENIOR_CANCELED')).toThrow();
    expect(() => alert.raiseToCritical()).toThrow();
  });

  it('une alerte résolue ne peut plus être escaladée', () => {
    const alert = newAlert();
    alert.resolve('ACTIVITY_RESUMED');
    expect(() => alert.escalate('WARNING')).toThrow(/RESOLVED/);
  });

  it('la pré-confirmation ne démarre qu\'une fois', () => {
    const alert = newAlert();
    alert.startPreConfirmation();
    expect(() => alert.startPreConfirmation()).toThrow(/PRE_CONFIRMING/);
  });
});

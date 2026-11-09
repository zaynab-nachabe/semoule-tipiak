import type { AlertView, NotificationView } from '@project/shared-types';
import { describe, expect, it } from 'vitest';
import { chronological, medicalActions, prependNotification, secondsLeft, upsertAlert } from '../src/model/alerts';
import { formatAgo, severityLabel } from '../src/model/labels';

const alert = (patch: Partial<AlertView>): AlertView => ({
  alertId: 'a-1',
  seniorId: 'senior-001',
  status: 'ESCALATED',
  reason: 'FALL_DETECTED',
  severity: 'WARNING',
  escalationCause: 'NO_RESPONSE',
  cancellationCause: null,
  createdAt: '2026-01-15T14:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  closedAt: null,
  ...patch,
});

describe('alertes reçues en temps réel', () => {
  it('une mise à jour remplace l\'alerte, la liste reste du plus récent au plus ancien', () => {
    const older = alert({ alertId: 'old', createdAt: '2026-01-14T10:00:00.000Z', status: 'RESOLVED' });
    const list = upsertAlert([older, alert({})], alert({ severity: 'CRITICAL' }));
    expect(list.map((a) => a.alertId)).toEqual(['a-1', 'old']);
    expect(list[0]?.severity).toBe('CRITICAL');
  });

  it('une notification déjà reçue n\'est pas dupliquée', () => {
    const n = { notificationId: 'n-1' } as NotificationView;
    expect(prependNotification([n], n)).toHaveLength(1);
  });
});

describe('actions du médical (mêmes règles que l\'API)', () => {
  it('alerte escaladée non prise en charge : prise en charge et clôture', () => {
    expect(medicalActions(alert({}))).toEqual({ canAcknowledge: true, canClose: true });
  });
  it('déjà prise en charge : clôture seulement', () => {
    expect(medicalActions(alert({ acknowledgedAt: '2026-01-15T14:05:00.000Z' }))).toEqual({ canAcknowledge: false, canClose: true });
  });
  it('levée de doute en cours ou alerte terminée : aucune action', () => {
    expect(medicalActions(alert({ status: 'PRE_CONFIRMING', severity: null }))).toEqual({ canAcknowledge: false, canClose: false });
    expect(medicalActions(alert({ status: 'RESOLVED', closedAt: '2026-01-15T15:00:00.000Z' }))).toEqual({ canAcknowledge: false, canClose: false });
  });
});

describe('affichage', () => {
  it('compte à rebours de la levée de doute, jamais négatif', () => {
    const now = new Date('2026-01-15T14:00:00.000Z');
    expect(secondsLeft('2026-01-15T14:01:00.000Z', now)).toBe(60);
    expect(secondsLeft('2026-01-15T13:59:00.000Z', now)).toBe(0);
  });
  it('points de courbe remis dans l\'ordre chronologique', () => {
    const points = [{ timestamp: '2026-01-15T14:02:00.000Z' }, { timestamp: '2026-01-15T14:01:00.000Z' }];
    expect(chronological(points).map((p) => p.timestamp)).toEqual(['2026-01-15T14:01:00.000Z', '2026-01-15T14:02:00.000Z']);
  });
  it('durées relatives et niveaux de gravité en français', () => {
    const now = new Date('2026-01-15T14:00:00.000Z');
    expect(formatAgo('2026-01-15T13:57:00.000Z', now)).toBe('il y a 3 min');
    expect(formatAgo('2026-01-15T11:00:00.000Z', now)).toBe('il y a 3 h');
    expect(severityLabel.CRITICAL).toBe('Niveau 3 · urgence');
  });
});

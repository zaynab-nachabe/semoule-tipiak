// Vue médicale : état détaillé, prise en charge et clôture des alertes escaladées, courbe cardiaque.

import type { AlertView, MeasurementPointView, Paginated } from '@project/shared-types';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { AlertHistory, Card, ErrorNote, NotificationInbox, StatusSummary } from '../components/common';
import { HeartRateChart } from '../components/HeartRateChart';
import { useNotifications, useSeniorFeed } from '../hooks/data';
import { medicalActions } from '../model/alerts';

export function MedicalView({ seniorId, seniorName }: { seniorId: string; seniorName: string }) {
  const { status, alerts, error, refresh } = useSeniorFeed(seniorId);
  const inbox = useNotifications();
  const [heartRate, setHeartRate] = useState<MeasurementPointView[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Courbe des 24 dernières heures, rechargée quand une nouvelle mesure arrive dans le statut.
  const latestBeat = status?.latestHeartRate?.timestamp;
  useEffect(() => {
    const from = new Date(Date.now() - 24 * 3600_000).toISOString();
    api<Paginated<MeasurementPointView>>(`/seniors/${seniorId}/measurements?type=HEART_RATE&from=${encodeURIComponent(from)}&pageSize=100`)
      .then((page) => setHeartRate(page.items))
      .catch((e: Error) => setActionError(e.message));
  }, [seniorId, latestBeat]);

  const act = async (alert: AlertView, action: 'acknowledge' | 'close') => {
    setBusy(`${alert.alertId}:${action}`);
    setActionError(null);
    try {
      await api<AlertView>(`/seniors/${seniorId}/alerts/${alert.alertId}/${action}`, { method: 'POST' });
      await refresh(); // la mise à jour arrive aussi en temps réel
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const renderActions = (alert: AlertView) => {
    const { canAcknowledge, canClose } = medicalActions(alert);
    if (!canAcknowledge && !canClose) return null;
    return (
      <div className="row-actions">
        {canAcknowledge && (
          <button type="button" disabled={busy !== null} onClick={() => void act(alert, 'acknowledge')}>
            Prendre en charge
          </button>
        )}
        {canClose && (
          <button type="button" className="secondary" disabled={busy !== null} onClick={() => void act(alert, 'close')}>
            Clôturer l’alerte
          </button>
        )}
      </div>
    );
  };

  const active = status?.activeAlert ?? null;
  return (
    <div className="grid-main">
      <div className="stack">
        <Card title={seniorName}>
          <ErrorNote message={error} />
          {status ? <StatusSummary status={status} /> : <p className="muted">Chargement…</p>}
          {active && renderActions(active)}
          <ErrorNote message={actionError} />
        </Card>
        <Card title="Fréquence cardiaque (24 h)">
          <HeartRateChart points={heartRate} />
        </Card>
        <Card title="Historique des alertes">
          <AlertHistory alerts={alerts} renderActions={renderActions} />
        </Card>
      </div>
      <Card title="Notifications" actions={inbox.unread > 0 ? <span className="badge count">{inbox.unread} non lue(s)</span> : null}>
        <ErrorNote message={inbox.error} />
        <NotificationInbox items={inbox.items} onRead={(id) => void inbox.markRead(id)} />
      </Card>
    </div>
  );
}

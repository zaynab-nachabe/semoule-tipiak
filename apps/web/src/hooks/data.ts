// Données d'une vue : chargement REST puis mise à jour par le temps réel.

import type { AlertView, NotificationView, Paginated, SeniorStatusView } from '@project/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useRealtimeMessage } from '../api/realtime';
import { prependNotification, upsertAlert } from '../model/alerts';

/** Statut et historique des alertes d'un senior, tenus à jour en temps réel. */
export function useSeniorFeed(seniorId: string) {
  const [status, setStatus] = useState<SeniorStatusView | null>(null);
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, page] = await Promise.all([
        api<SeniorStatusView>(`/seniors/${seniorId}/status`),
        api<Paginated<AlertView>>(`/seniors/${seniorId}/alerts?pageSize=20`),
      ]);
      setStatus(nextStatus);
      setAlerts(page.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [seniorId]);

  useEffect(() => {
    setStatus(null);
    setAlerts([]);
    void refresh();
  }, [refresh]);

  const onAlert = (alert: AlertView) => {
    if (alert.seniorId !== seniorId) return;
    setAlerts((list) => upsertAlert(list, alert));
    void refresh(); // le statut (alerte en cours, dernière activité) est recalculé par l'API
  };
  useRealtimeMessage('alert.created', onAlert);
  useRealtimeMessage('alert.updated', onAlert);

  return { status, alerts, error, refresh };
}

/** Boîte de réception de l'appelant (famille, médical). */
export function useNotifications() {
  const [items, setItems] = useState<NotificationView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Paginated<NotificationView>>('/me/notifications?pageSize=30')
      .then((page) => setItems(page.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  useRealtimeMessage('notification.created', (notification) => setItems((list) => prependNotification(list, notification)));

  const markRead = useCallback(async (notificationId: string) => {
    try {
      const updated = await api<NotificationView>(`/me/notifications/${notificationId}/read`, { method: 'POST' });
      setItems((list) => list.map((n) => (n.notificationId === notificationId ? updated : n)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  return { items, unread: items.filter((n) => n.readAt === null).length, error, markRead };
}

/** Heure courante, rafraîchie à intervalle régulier (comptes à rebours, « il y a 3 min »). */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

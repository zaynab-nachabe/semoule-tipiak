// Vue senior : grands boutons, peu d'informations. « Tout va bien » pendant une levée de doute, et
// « J'ai besoin d'aide » à tout moment. Les deux passent par l'API puis l'ingestion (ADR 0007).

import type { ActionAcceptedView, RealtimeMessageByType } from '@project/shared-types';
import { useState } from 'react';
import { ApiRequestError, api } from '../api/client';
import { useRealtimeMessage } from '../api/realtime';
import { AbsenceCard } from '../components/AbsenceCard';
import { AlertHistory, Card, ErrorNote } from '../components/common';
import { useNow, useSeniorFeed } from '../hooks/data';
import { secondsLeft } from '../model/alerts';
import { formatAgo } from '../model/labels';

type PreConfirmation = RealtimeMessageByType['preconfirmation.requested'];

export function SeniorView({ seniorId, firstName }: { seniorId: string; firstName: string }) {
  const { status, alerts, error, refresh } = useSeniorFeed(seniorId);
  const [request, setRequest] = useState<PreConfirmation | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const now = useNow();

  useRealtimeMessage('preconfirmation.requested', (message) => {
    if (message.seniorId !== seniorId) return;
    setRequest(message);
    setFeedback(null);
  });

  // Levée de doute en cours : annoncée en temps réel (avec son échéance) ou retrouvée dans le statut
  // si l'application est ouverte après coup (sans échéance connue).
  const known = request ? alerts.find((a) => a.alertId === request.alertId) : undefined;
  const fromRealtime = request && (known?.status ?? 'PRE_CONFIRMING') === 'PRE_CONFIRMING' ? request : null;
  const active = status?.activeAlert ?? null;
  const pending = fromRealtime
    ? { alertId: fromRealtime.alertId, expiresAt: fromRealtime.expiresAt as string | null }
    : active?.status === 'PRE_CONFIRMING'
      ? { alertId: active.alertId, expiresAt: null }
      : null;

  const send = async (path: string, done: string) => {
    setSending(true);
    setActionError(null);
    try {
      await api<ActionAcceptedView>(path, { method: 'POST' });
      setFeedback(done);
    } catch (e) {
      setActionError(e instanceof ApiRequestError && e.status === 409 ? "Trop tard pour annuler : vos proches sont déjà prévenus." : (e as Error).message);
    } finally {
      setSending(false);
    }
  };
  const cancel = (alertId: string) => send(`/seniors/${seniorId}/alerts/${alertId}/cancel`, 'Merci. L’alerte est annulée.');
  const help = () => send(`/seniors/${seniorId}/help`, 'Votre demande d’aide est envoyée. Vos proches et l’équipe médicale sont prévenus.');

  const remaining = pending?.expiresAt ? secondsLeft(pending.expiresAt, now) : null;

  return (
    <div className="senior">
      <h1 className="senior-hello">Bonjour {firstName}</h1>
      <ErrorNote message={error} />

      {pending ? (
        <section className="senior-panel is-question" aria-live="assertive">
          <p className="senior-big">Avez-vous chuté ? Tout va bien ?</p>
          {remaining !== null && (
            <p className="senior-countdown">
              {remaining > 0 ? `Sans réponse, vos proches seront prévenus dans ${remaining} s` : 'Délai écoulé : vos proches vont être prévenus'}
            </p>
          )}
          <div className="senior-buttons">
            <button type="button" className="btn-ok" disabled={sending} onClick={() => void cancel(pending.alertId)}>
              Tout va bien
            </button>
            <button type="button" className="btn-help" disabled={sending} onClick={() => void help()}>
              J’ai besoin d’aide
            </button>
          </div>
        </section>
      ) : (
        <section className={`senior-panel ${active ? 'is-alert' : 'is-ok'}`} aria-live="polite">
          {active ? (
            <>
              <p className="senior-big">Vos proches et l’équipe médicale sont prévenus.</p>
              <p>{active.acknowledgedAt ? 'L’équipe médicale s’occupe de vous.' : 'Restez calme, quelqu’un va vous contacter.'}</p>
            </>
          ) : (
            <p className="senior-big">Tout va bien</p>
          )}
          <div className="senior-buttons">
            <button type="button" className="btn-help" disabled={sending} onClick={() => void help()}>
              J’ai besoin d’aide
            </button>
          </div>
        </section>
      )}

      {feedback && (
        <p className="feedback" role="status">
          {feedback}
        </p>
      )}
      <ErrorNote message={actionError} />

      {status && <AbsenceCard seniorId={seniorId} absence={status.absence} onChange={() => void refresh()} />}

      <div className="grid-2">
        <Card title="Mon cœur aujourd’hui">
          {status?.latestHeartRate ? (
            <p className="senior-metric">
              {status.latestHeartRate.value} <small>{status.latestHeartRate.unit}</small>
              <span className="muted"> · {formatAgo(status.latestHeartRate.timestamp, now)}</span>
            </p>
          ) : (
            <p className="muted">Pas de mesure récente de la montre.</p>
          )}
        </Card>
        <Card title="Mes dernières alertes">
          <AlertHistory alerts={alerts.slice(0, 5)} />
        </Card>
      </div>
    </div>
  );
}

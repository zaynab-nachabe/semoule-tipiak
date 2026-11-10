// Composants partagés par les trois vues.

import type { AlertView, NotificationView, SeniorStatusView } from '@project/shared-types';
import type { ReactNode } from 'react';
import { useNow } from '../hooks/data';
import {
  cancellationCauseLabel,
  escalationCauseLabel,
  formatAgo,
  formatWhen,
  priorityLabel,
  reasonLabel,
  severityLabel,
  statusLabel,
} from '../model/labels';

export function Card({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2>{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}

export function SeverityBadge({ alert }: { alert: AlertView }) {
  if (alert.severity) return <span className={`badge sev-${alert.severity}`}>{severityLabel[alert.severity]}</span>;
  return <span className={`badge status-${alert.status}`}>{statusLabel[alert.status]}</span>;
}

/** Résumé de l'état d'un senior (famille, médical). */
export function StatusSummary({ status }: { status: SeniorStatusView }) {
  const now = useNow(30_000);
  const alert = status.activeAlert;
  return (
    <div className={`status-banner ${alert ? 'is-alert' : 'is-ok'}`}>
      <p className="status-title">{alert ? `${reasonLabel[alert.reason]} : ${statusLabel[alert.status].toLowerCase()}` : 'Tout va bien'}</p>
      {alert && (
        <p className="status-detail">
          <SeverityBadge alert={alert} /> depuis {formatWhen(alert.createdAt, now)}
          {alert.acknowledgedAt ? ' · prise en charge par l’équipe médicale' : ' · pas encore prise en charge'}
        </p>
      )}
      <dl className="facts">
        <div>
          <dt>Dernière activité</dt>
          <dd>{status.lastActivityAt ? formatAgo(status.lastActivityAt, now) : 'aucune donnée'}</dd>
        </div>
        <div>
          <dt>Pièce</dt>
          <dd>{status.currentRoom ?? 'inconnue'}</dd>
        </div>
        {status.latestHeartRate && (
          <div>
            <dt>Fréquence cardiaque</dt>
            <dd>
              {status.latestHeartRate.value} {status.latestHeartRate.unit} ({formatAgo(status.latestHeartRate.timestamp, now)})
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** Historique des alertes. `renderActions` ajoute des boutons par alerte (médical). */
export function AlertHistory({ alerts, renderActions }: { alerts: readonly AlertView[]; renderActions?: (alert: AlertView) => ReactNode }) {
  if (alerts.length === 0) return <p className="muted">Aucune alerte.</p>;
  return (
    <ul className="alert-list">
      {alerts.map((alert) => (
        <li key={alert.alertId} className={alert.status === 'RESOLVED' ? 'is-resolved' : ''}>
          <div className="alert-main">
            <strong>{reasonLabel[alert.reason]}</strong> <SeverityBadge alert={alert} />
            {alert.severity && alert.status === 'RESOLVED' && <span className="badge status-RESOLVED">{statusLabel.RESOLVED}</span>}
            <span className="muted"> · {formatWhen(alert.createdAt)}</span>
          </div>
          <div className="alert-meta">
            {alert.escalationCause && <span>Cause : {escalationCauseLabel[alert.escalationCause]}</span>}
            {alert.cancellationCause && <span>{cancellationCauseLabel[alert.cancellationCause]}</span>}
            {alert.acknowledgedAt && <span>Prise en charge à {formatWhen(alert.acknowledgedAt)}</span>}
            {alert.closedAt && <span>Clôturée à {formatWhen(alert.closedAt)}</span>}
            {alert.status === 'RESOLVED' && !alert.closedAt && alert.resolvedAt && <span>Terminée à {formatWhen(alert.resolvedAt)}</span>}
          </div>
          {renderActions?.(alert)}
        </li>
      ))}
    </ul>
  );
}

/** Boîte de réception (famille, médical). */
export function NotificationInbox({ items, onRead }: { items: readonly NotificationView[]; onRead: (id: string) => void }) {
  if (items.length === 0) return <p className="muted">Aucune notification.</p>;
  return (
    <ul className="inbox">
      {items.map((n) => (
        <li key={n.notificationId} className={`prio-${n.priority} ${n.readAt ? 'is-read' : 'is-unread'}`}>
          <div className="inbox-head">
            <span className={`badge prio-${n.priority}`}>{priorityLabel[n.priority]}</span>
            <strong>{n.title}</strong>
          </div>
          <p>{n.message}</p>
          <div className="inbox-foot">
            <span className="muted">{formatWhen(n.createdAt)}</span>
            {n.readAt ? (
              <span className="muted">Lue</span>
            ) : (
              <button type="button" className="link" onClick={() => onRead(n.notificationId)}>
                Marquer comme lue
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

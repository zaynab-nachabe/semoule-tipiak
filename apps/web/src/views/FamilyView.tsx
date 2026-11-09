// Vue famille : être rassurée, être prévenue seulement si c'est important. Pas de données médicales
// détaillées (l'API ne les envoie pas à ce rôle).

import { AlertHistory, Card, ErrorNote, NotificationInbox, StatusSummary } from '../components/common';
import { useNotifications, useSeniorFeed } from '../hooks/data';

export function FamilyView({ seniorId, seniorName }: { seniorId: string; seniorName: string }) {
  const { status, alerts, error } = useSeniorFeed(seniorId);
  const inbox = useNotifications();

  return (
    <div className="grid-main">
      <div className="stack">
        <Card title={seniorName}>
          <ErrorNote message={error} />
          {status ? <StatusSummary status={status} /> : <p className="muted">Chargement…</p>}
        </Card>
        <Card title="Historique des alertes">
          <AlertHistory alerts={alerts} />
        </Card>
      </div>
      <Card title="Notifications" actions={inbox.unread > 0 ? <span className="badge count">{inbox.unread} non lue(s)</span> : null}>
        <ErrorNote message={inbox.error} />
        <NotificationInbox items={inbox.items} onRead={(id) => void inbox.markRead(id)} />
      </Card>
    </div>
  );
}

// État des capteurs (ADR 0012, risque R1) : détaillé pour l'équipe médicale, simplifié pour la famille.

import type { SensorHealthView } from '@project/shared-types';
import { useNow } from '../hooks/data';
import { useSensors } from '../hooks/sensors';
import { formatAgo } from '../model/labels';
import { sensorName, sensorProblems, sensorStatusLabel } from '../model/sensors';
import { Card, ErrorNote } from './common';

function StatusBadge({ sensor }: { sensor: SensorHealthView }) {
  return <span className={`badge sensor-${sensor.status}`}>{sensorStatusLabel[sensor.status]}</span>;
}

/** Équipe médicale : tous les capteurs, dernier signal, batterie, modèle. */
export function SensorsCard({ seniorId }: { seniorId: string }) {
  const { sensors, error } = useSensors(seniorId);
  const now = useNow(30_000);
  const problems = sensorProblems(sensors).length;
  return (
    <Card title="Capteurs" actions={problems > 0 ? <span className="badge count">{problems} à vérifier</span> : null}>
      <ErrorNote message={error} />
      {sensors.length === 0 ? (
        <p className="muted">Aucun capteur enregistré.</p>
      ) : (
        <ul className="sensor-list">
          {sensors.map((s) => (
            <li key={s.sensorId} className={s.status !== 'ONLINE' ? 'is-problem' : ''}>
              <div className="sensor-main">
                <strong>{sensorName(s)}</strong> <StatusBadge sensor={s} />
              </div>
              <div className="alert-meta">
                <span>{s.lastSeenAt ? `Dernier signal ${formatAgo(s.lastSeenAt, now)}` : 'Aucun signal reçu'}</span>
                {s.battery && <span>Batterie {s.battery.value} %</span>}
                {s.expectedIntervalMinutes && <span>Attendu toutes les {s.expectedIntervalMinutes} min</span>}
                {s.model && <span>{s.model}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Famille : seulement ce qui ne va pas, en clair. */
export function SensorsSummary({ seniorId }: { seniorId: string }) {
  const { sensors, error } = useSensors(seniorId);
  const problems = sensorProblems(sensors);
  return (
    <Card title="Équipement">
      <ErrorNote message={error} />
      {problems.length === 0 ? (
        <p className="muted">{sensors.length > 0 ? `Les ${sensors.length} capteurs fonctionnent.` : 'Aucun capteur enregistré.'}</p>
      ) : (
        <ul className="sensor-list">
          {problems.map((s) => (
            <li key={s.sensorId} className="is-problem">
              <strong>{sensorName(s)}</strong> <StatusBadge sensor={s} />
              {s.kind === 'WATCH' && s.status === 'OFFLINE' && (
                <p className="small">Les chutes ne sont plus détectées : vérifiez que la montre est chargée et portée.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

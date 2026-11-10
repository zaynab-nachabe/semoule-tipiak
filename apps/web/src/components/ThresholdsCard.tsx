// Seuils d'inactivité (médical, ADR 0010) : lecture et modification. À l'enregistrement, l'API publie le
// nouveau profil et la détection l'applique aussitôt.

import type { ActivityProfile, ThresholdsUpdateRequest, ToleranceThreshold } from '@project/shared-types';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatDuration } from '../model/labels';
import { Card, ErrorNote } from './common';

/** Ligne éditable : une plage horaire, ou le seuil par défaut (toute heure non couverte). */
interface Row {
  key: number;
  allDay: boolean;
  startTime: string;
  endTime: string;
  minutes: number;
}

let nextKey = 1;
const toRow = (t: ToleranceThreshold): Row => ({
  key: nextKey++,
  allDay: t.timeRange === null,
  startTime: t.timeRange?.startTime ?? '07:00',
  endTime: t.timeRange?.endTime ?? '22:00',
  minutes: t.durationInMinutes,
});
const toThreshold = (r: Row): ToleranceThreshold => ({
  condition: 'MAX_INACTIVITY_MINUTES',
  durationInMinutes: r.minutes,
  timeRange: r.allDay ? null : { startTime: r.startTime, endTime: r.endTime },
});

export function ThresholdsCard({ seniorId }: { seniorId: string }) {
  const [profile, setProfile] = useState<ActivityProfile | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<ActivityProfile>(`/seniors/${seniorId}/thresholds`)
      .then((p) => {
        setProfile(p);
        setRows(p.thresholds.map(toRow));
      })
      .catch((e: Error) => setError(e.message));
  }, [seniorId]);

  const update = (key: number, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: ThresholdsUpdateRequest = { thresholds: rows.map(toThreshold) };
      const next = await api<ActivityProfile>(`/seniors/${seniorId}/thresholds`, { method: 'PUT', body });
      setProfile(next);
      setRows(next.thresholds.map(toRow));
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setRows(profile?.thresholds.map(toRow) ?? []);
    setEditing(false);
    setError(null);
  };

  const actions = editing ? null : (
    <button
      type="button"
      className="secondary"
      onClick={() => {
        setEditing(true);
        setSaved(false);
      }}
      disabled={!profile}
    >
      Modifier
    </button>
  );

  return (
    <Card title="Seuils d’inactivité" actions={actions}>
      <p className="muted small">
        Au-delà de cette durée sans mouvement, la personne reçoit « Tout va bien ? ». Au lit, le seuil le plus long s’applique.
        {profile && ` Heures locales (${profile.timeZone}).`}
      </p>
      <ErrorNote message={error} />
      {saved && (
        <p className="feedback small" role="status">
          Seuils enregistrés : la détection les applique aussitôt.
        </p>
      )}

      {!editing && profile && (
        profile.thresholds.length === 0 ? (
          <p className="muted">Aucun seuil : l’inactivité n’est pas surveillée.</p>
        ) : (
          <ul className="thresholds">
            {profile.thresholds.map((t, i) => (
              <li key={i}>
                <span>{t.timeRange ? `${t.timeRange.startTime} → ${t.timeRange.endTime}` : 'Autres heures'}</span>
                <strong>{formatDuration(t.durationInMinutes)}</strong>
              </li>
            ))}
          </ul>
        )
      )}

      {editing && (
        <form
          className="thresholds-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {rows.map((r) => (
            <fieldset key={r.key} className="threshold-row">
              <legend className="visually-hidden">Seuil</legend>
              <label className="check">
                <input type="checkbox" checked={r.allDay} onChange={(e) => update(r.key, { allDay: e.target.checked })} /> Autres heures
              </label>
              {!r.allDay && (
                <>
                  <label>
                    De <input type="time" required value={r.startTime} onChange={(e) => update(r.key, { startTime: e.target.value })} />
                  </label>
                  <label>
                    à <input type="time" required value={r.endTime} onChange={(e) => update(r.key, { endTime: e.target.value })} />
                  </label>
                </>
              )}
              <label>
                Durée (min){' '}
                <input
                  type="number"
                  min={1}
                  max={1440}
                  required
                  value={r.minutes}
                  onChange={(e) => update(r.key, { minutes: Number(e.target.value) })}
                />
              </label>
              <button type="button" className="link" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                Retirer
              </button>
            </fieldset>
          ))}
          <div className="row-actions">
            <button
              type="button"
              className="secondary"
              disabled={rows.length >= 10}
              onClick={() => setRows((list) => [...list, { key: nextKey++, allDay: false, startTime: '07:00', endTime: '22:00', minutes: 120 }])}
            >
              Ajouter un seuil
            </button>
            <button type="submit" disabled={saving}>
              Enregistrer
            </button>
            <button type="button" className="link" onClick={cancel}>
              Annuler
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

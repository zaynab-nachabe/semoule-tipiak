// Vue senior : « Je m'absente » (avec heure de retour) et « Je suis rentré(e) » (ADR 0011).
// Pendant l'absence, l'inactivité n'est pas surveillée ; la chute et le bouton d'aide le restent.

import type { AbsenceRequest, AbsenceView } from '@project/shared-types';
import { useState } from 'react';
import { api } from '../api/client';
import { useNow } from '../hooks/data';
import { defaultReturnTime, returnTimeFor } from '../model/absence';
import { formatWhen } from '../model/labels';
import { Card, ErrorNote } from './common';

export function AbsenceCard({ seniorId, absence, onChange }: { seniorId: string; absence: AbsenceView | null; onChange: () => void }) {
  const now = useNow(30_000);
  const [choosing, setChoosing] = useState(false);
  const [returnAt, setReturnAt] = useState(() => defaultReturnTime(new Date()));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setSending(true);
    setError(null);
    try {
      await action();
      setChoosing(false);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const leave = () => {
    const until = returnTimeFor(returnAt, new Date());
    if (!until) {
      setError('Heure de retour invalide');
      return;
    }
    const body: AbsenceRequest = { until: until.toISOString() };
    void run(() => api(`/seniors/${seniorId}/absence`, { method: 'POST', body }));
  };
  const back = () => void run(() => api(`/seniors/${seniorId}/absence`, { method: 'DELETE' }));

  return (
    <Card title="Je sors de chez moi">
      {absence ? (
        <div className="absence-on" aria-live="polite">
          <p className="senior-big">Vous êtes sorti(e) jusqu’à {formatWhen(absence.until, now)}</p>
          <p className="muted">Vos proches ne seront pas inquiétés si la maison reste calme. En cas de problème, le bouton d’aide fonctionne toujours.</p>
          <div className="senior-buttons">
            <button type="button" className="btn-ok" disabled={sending} onClick={back}>
              Je suis rentré(e)
            </button>
          </div>
        </div>
      ) : choosing ? (
        <form
          className="absence-form"
          onSubmit={(e) => {
            e.preventDefault();
            leave();
          }}
        >
          <label>
            Je rentre vers <input type="time" required value={returnAt} onChange={(e) => setReturnAt(e.target.value)} />
          </label>
          <div className="senior-buttons">
            <button type="submit" disabled={sending}>
              Je m’absente
            </button>
            <button type="button" className="secondary" onClick={() => setChoosing(false)}>
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted">Prévenez avant de sortir : le système ne s’inquiétera pas de ne plus vous voir bouger.</p>
          <div className="senior-buttons">
            <button type="button" className="secondary" onClick={() => setChoosing(true)}>
              Je m’absente
            </button>
          </div>
        </>
      )}
      <ErrorNote message={error} />
    </Card>
  );
}

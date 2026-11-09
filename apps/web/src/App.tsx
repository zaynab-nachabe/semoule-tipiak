// Application unique, trois vues : le rôle du compte connecté choisit la vue (senior, famille, médical).

import type { LoginResponse, MeView } from '@project/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { api, setToken, setUnauthorizedHandler } from './api/client';
import { RealtimeProvider, useRealtime } from './api/realtime';
import { ErrorNote } from './components/common';
import { roleLabel } from './model/labels';
import { FamilyView } from './views/FamilyView';
import { Login } from './views/Login';
import { MedicalView } from './views/MedicalView';
import { SeniorView } from './views/SeniorView';

const STORAGE_KEY = 'veille-senior.token';

// Le jeton est gardé pour l'onglet seulement (confort : survivre à un rechargement de la page).
function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function storeToken(value: string | null): void {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* stockage indisponible : la session ne survivra pas au rechargement */
  }
}

export function App() {
  const [token, setSessionToken] = useState<string | null>(() => {
    const stored = readStoredToken();
    setToken(stored);
    return stored;
  });

  const logout = useCallback(() => {
    setToken(null);
    storeToken(null);
    setSessionToken(null);
  }, []);

  useEffect(() => setUnauthorizedHandler(logout), [logout]);

  const login = ({ token: next }: LoginResponse) => {
    setToken(next);
    storeToken(next);
    setSessionToken(next);
  };

  if (!token) return <Login onLogin={login} />;
  return (
    <RealtimeProvider token={token}>
      <Session onLogout={logout} />
    </RealtimeProvider>
  );
}

function Session({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<MeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seniorId, setSeniorId] = useState<string | null>(null);
  const { connected } = useRealtime();

  useEffect(() => {
    api<MeView>('/me')
      .then((profile) => {
        setMe(profile);
        setSeniorId(profile.seniors[0]?.seniorId ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const selected = me?.seniors.find((s) => s.seniorId === seniorId) ?? null;

  return (
    <div className={`app role-${me?.role ?? 'none'}`}>
      <header className="topbar">
        <div className="brand">Veille Senior</div>
        {me && (
          <div className="who">
            <span className={`role-dot dot-${me.role}`} aria-hidden="true" />
            {me.fullName} <span className="muted">· {roleLabel[me.role]}</span>
          </div>
        )}
        <span className={`live ${connected ? 'is-on' : 'is-off'}`} title="Réception des alertes en temps réel">
          {connected ? 'En direct' : 'Hors ligne'}
        </span>
        <button type="button" className="secondary" onClick={onLogout}>
          Changer de compte
        </button>
      </header>

      {me && me.role !== 'SENIOR' && me.seniors.length > 1 && (
        <nav className="senior-tabs" aria-label="Personnes suivies">
          {me.seniors.map((s) => (
            <button key={s.seniorId} type="button" aria-pressed={s.seniorId === seniorId} onClick={() => setSeniorId(s.seniorId)}>
              {s.fullName}
            </button>
          ))}
        </nav>
      )}

      <main className="content">
        <ErrorNote message={error} />
        {me && !selected && <p className="muted">Aucune personne suivie : une relation consentie est nécessaire pour voir un senior.</p>}
        {me && selected && me.role === 'SENIOR' && <SeniorView seniorId={selected.seniorId} firstName={me.fullName.split(' ')[0] ?? me.fullName} />}
        {me && selected && me.role === 'FAMILY' && <FamilyView key={selected.seniorId} seniorId={selected.seniorId} seniorName={selected.fullName} />}
        {me && selected && me.role === 'MEDICAL' && <MedicalView key={selected.seniorId} seniorId={selected.seniorId} seniorName={selected.fullName} />}
      </main>
    </div>
  );
}

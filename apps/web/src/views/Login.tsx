// Connexion : choix d'un compte dans une liste, sans mot de passe (hors du périmètre du sujet).

import type { LoginResponse, UserSummary } from '@project/shared-types';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ErrorNote } from '../components/common';
import { roleLabel } from '../model/labels';

export function Login({ onLogin }: { onLogin: (session: LoginResponse) => void }) {
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    api<UserSummary[]>('/auth/users')
      .then(setUsers)
      .catch((e: Error) => setError(e.message));
  }, []);

  const login = async (email: string) => {
    setPending(email);
    try {
      onLogin(await api<LoginResponse>('/auth/login', { method: 'POST', body: { email } }));
    } catch (e) {
      setError((e as Error).message);
      setPending(null);
    }
  };

  return (
    <main className="login">
      <h1>Veille Senior</h1>
      <p className="muted">Choisissez un compte pour ouvrir sa vue.</p>
      <ErrorNote message={error} />
      {users === null && !error && <p className="muted">Chargement…</p>}
      <ul className="account-list">
        {users?.map((user) => (
          <li key={user.email}>
            <button type="button" className="account" disabled={pending !== null} onClick={() => void login(user.email)}>
              <span className={`role-dot dot-${user.role}`} aria-hidden="true" />
              <span>
                <strong>{user.fullName}</strong>
                <span className="muted">
                  {roleLabel[user.role]} · {user.email}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

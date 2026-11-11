// Temps réel (docs/contrat-api.md §4) : une seule connexion socket.io par session, partagée par les vues.
// L'API ne pousse à chacun que ce que son rôle l'autorise à voir.

import type { RealtimeMessageByType, RealtimeMessageType } from '@project/shared-types';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io } from 'socket.io-client';

type Handler<K extends RealtimeMessageType> = (message: RealtimeMessageByType[K]) => void;
type AnyHandler = (message: unknown) => void;

const MESSAGE_TYPES: readonly RealtimeMessageType[] = [
  'alert.created',
  'alert.updated',
  'notification.created',
  'preconfirmation.requested',
  'absence.changed',
];

interface Realtime {
  readonly connected: boolean;
  subscribe<K extends RealtimeMessageType>(type: K, handler: Handler<K>): () => void;
}

const RealtimeContext = createContext<Realtime | null>(null);

export function RealtimeProvider({ token, children }: { token: string; children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const handlers = useRef(new Map<RealtimeMessageType, Set<AnyHandler>>());

  useEffect(() => {
    const socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket'] });
    socket.on('ready', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    for (const type of MESSAGE_TYPES) {
      socket.on(type, (message: unknown) => {
        for (const handler of handlers.current.get(type) ?? []) handler(message);
      });
    }
    return () => {
      socket.close();
    };
  }, [token]);

  const value = useMemo<Realtime>(
    () => ({
      connected,
      subscribe(type, handler) {
        const set = handlers.current.get(type) ?? new Set<AnyHandler>();
        handlers.current.set(type, set);
        const anyHandler = handler as AnyHandler;
        set.add(anyHandler);
        return () => set.delete(anyHandler);
      },
    }),
    [connected],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): Realtime {
  const realtime = useContext(RealtimeContext);
  if (!realtime) throw new Error('useRealtime hors de RealtimeProvider');
  return realtime;
}

/** S'abonne à un type de message tant que le composant est affiché. */
export function useRealtimeMessage<K extends RealtimeMessageType>(type: K, handler: Handler<K>): void {
  const { subscribe } = useRealtime();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribe(type, (message) => latest.current(message)), [subscribe, type]);
}

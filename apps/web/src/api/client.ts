// Appels REST vers l'API (docs/contrat-api.md). L'application parle à sa propre origine : nginx (ou Vite en
// développement) relaie /api vers l'api-gateway, ce qui évite tout souci d'origine croisée.

import type { ApiError } from '@project/shared-types';

export const API_BASE = '/api';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: () => void = () => undefined;

export function setToken(value: string | null): void {
  token = value;
}

/** Appelé quand l'API répond 401 (jeton expiré) : l'application revient à l'écran de connexion. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export async function api<T>(path: string, options: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK', 'Le serveur ne répond pas. Vérifiez la connexion.');
  }

  const data = await readJson(response);
  if (!response.ok) {
    if (response.status === 401 && token) onUnauthorized();
    const error = isApiError(data) ? data.error : null;
    throw new ApiRequestError(response.status, error?.code ?? 'ERROR', error?.message ?? `Erreur ${response.status}`);
  }
  return data as T;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null; // ex. page d'erreur HTML du relais si l'API est arrêtée
  }
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && 'error' in value;
}

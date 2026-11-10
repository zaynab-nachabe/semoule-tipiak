// Adaptateurs des profils d'activité (ADR 0010) :
//  - au démarrage, lecture de tous les profils à l'API (GET /internal/activity-profiles, clé de service) ;
//  - ensuite, mises à jour reçues sur profiles/{seniorId} (ActivityProfileUpdated).
// Les deux valident le contrat (activity-profile.schema.json) avant de toucher au domaine.

import Ajv from 'ajv';
import {
  INTERNAL_PROFILES_ROUTE,
  SERVICE_TOKEN_HEADER,
  Topics,
  type ActivityProfile as ActivityProfileData,
  type ActivityProfileUpdated,
} from '@project/shared-types';
import profileSchema from '@project/shared-types/schemas/activity-profile.schema.json';
import { ActivityProfile } from '../domain/aggregates/activity-profile.js';
import type { ProfileSource } from './config.js';
import type { Logger } from './logger.js';
import { RecentIds } from './recent-ids.js';

const ajv = new Ajv({ strict: true, allErrors: true });
const validateMessage = ajv.compile<ActivityProfileUpdated>(profileSchema);
const validateProfile = ajv.compile<ActivityProfileData>({ $ref: `${profileSchema.$id}#/definitions/ActivityProfile` });

/** Convertit un profil du contrat en agrégat ; null (et un avertissement) s'il est invalide. */
function toAggregate(data: unknown, logger: Logger, context: Record<string, unknown>): ActivityProfile | null {
  if (!validateProfile(data)) {
    logger.warn('profil ignoré : non conforme au contrat', { ...context, errors: validateProfile.errors });
    return null;
  }
  try {
    return ActivityProfile.fromContract(data);
  } catch (error) {
    logger.warn('profil ignoré : fuseau horaire inconnu', { ...context, timeZone: data.timeZone, error: (error as Error).message });
    return null;
  }
}

/**
 * Lit tous les profils à l'API. Réessaie tant que l'API ne répond pas (elle peut démarrer après la
 * détection) : en attendant, l'inactivité n'est pas surveillée (limite connue, matrice des risques).
 */
export async function fetchProfilesUntilAvailable(
  source: ProfileSource,
  logger: Logger,
  isStopped: () => boolean = () => false,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivityProfile[] | null> {
  const url = `${source.apiUrl}${INTERNAL_PROFILES_ROUTE}`;
  for (let attempt = 1; !isStopped(); attempt++) {
    try {
      const response = await fetchImpl(url, { headers: { [SERVICE_TOKEN_HEADER]: source.serviceToken }, signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        const body: unknown = await response.json();
        if (!Array.isArray(body)) throw new Error('réponse inattendue (tableau attendu)');
        const profiles = body.map((p) => toAggregate(p, logger, { source: 'api' })).filter((p): p is ActivityProfile => p !== null);
        logger.info('profils d\'activité chargés', { count: profiles.length, attempt });
        return profiles;
      }
      logger.warn('profils d\'activité : réponse de l\'API refusée', { status: response.status, attempt });
    } catch (error) {
      logger.warn('profils d\'activité : API injoignable, inactivité non surveillée pour l\'instant', {
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, source.retryDelayMs));
  }
  return null;
}

export interface ProfileHandlerDependencies {
  onProfile(profile: ActivityProfile): void;
  logger: Logger;
  recentIds?: RecentIds;
}

/** Traite un message reçu sur profiles/{seniorId} : JSON valide, conforme, cohérent avec son topic, pas en double. */
export function createProfileHandler(deps: ProfileHandlerDependencies): (topic: string, payload: Buffer) => void {
  const recentIds = deps.recentIds ?? new RecentIds();
  return (topic, payload) => {
    let data: unknown;
    try {
      data = JSON.parse(payload.toString('utf8'));
    } catch {
      deps.logger.warn('profil ignoré : JSON invalide', { topic });
      return;
    }
    if (!validateMessage(data)) {
      deps.logger.warn('profil ignoré : non conforme au contrat', { topic, errors: validateMessage.errors });
      return;
    }
    const message = data;
    if (Topics.profile(message.seniorId) !== topic || message.payload.seniorId !== message.seniorId) {
      deps.logger.warn('profil ignoré : topic incohérent avec le contenu', { topic, seniorId: message.seniorId });
      return;
    }
    if (!recentIds.remember(message.eventId)) return;
    const profile = toAggregate(message.payload, deps.logger, { topic });
    if (!profile) return;
    deps.onProfile(profile);
    deps.logger.info('profil d\'activité mis à jour', { seniorId: profile.seniorId, thresholds: profile.thresholds.length });
  };
}

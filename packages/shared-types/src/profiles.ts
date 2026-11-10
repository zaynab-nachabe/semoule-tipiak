// Profil d'activité d'un senior (docs/format-evenements.md §10, ADR 0010) : les seuils d'inactivité
// configurés par l'équipe médicale. L'API le fournit à la détection au démarrage, puis publie
// ActivityProfileUpdated sur profiles/{seniorId} à chaque modification.

import type { IsoUtcTimestamp, TopicSafeId, Uuid } from './common.js';

export const ProfileMessageType = { ActivityProfileUpdated: 'ActivityProfileUpdated' } as const;
export type ProfileMessageType = (typeof ProfileMessageType)[keyof typeof ProfileMessageType];

/** Seule condition gérée : durée maximale sans activité (DDD : ToleranceThreshold). */
export const ThresholdCondition = { MAX_INACTIVITY_MINUTES: 'MAX_INACTIVITY_MINUTES' } as const;
export type ThresholdCondition = (typeof ThresholdCondition)[keyof typeof ThresholdCondition];

/** Heure locale du senior, "HH:MM" sur 24 h (ex. "22:00"). */
export type LocalTime = string;

/** Plage horaire (DDD : TimeRange). Une plage peut passer minuit : 22:00 → 07:00. */
export interface TimeRange {
  startTime: LocalTime;
  endTime: LocalTime;
}

/**
 * Seuil de tolérance : au-delà de `durationInMinutes` sans activité, la détection lève le doute.
 * Sans plage horaire, le seuil s'applique à toute heure qui n'est couverte par aucune plage.
 */
export interface ToleranceThreshold {
  condition: ThresholdCondition;
  /** 1 à 1440 minutes. */
  durationInMinutes: number;
  timeRange: TimeRange | null;
}

export interface ActivityProfile {
  seniorId: TopicSafeId;
  /** Fuseau horaire IANA du logement, pour lire les plages horaires (ex. "Europe/Paris"). */
  timeZone: string;
  thresholds: ToleranceThreshold[];
}

/** Publié par l'API sur profiles/{seniorId} quand l'équipe médicale modifie les seuils. */
export interface ActivityProfileUpdated {
  eventId: Uuid;
  seniorId: TopicSafeId;
  type: 'ActivityProfileUpdated';
  timestamp: IsoUtcTimestamp;
  payload: ActivityProfile;
}

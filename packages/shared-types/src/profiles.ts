// Profil d'activité d'un senior (docs/format-evenements.md §10, ADR 0010 et 0011) : les seuils d'inactivité
// configurés par l'équipe médicale, l'absence déclarée par le senior et les capteurs attendus (ADR 0012). L'API le fournit à la détection au démarrage, puis publie
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

/**
 * Absence déclarée par le senior (« je m'absente », ADR 0011) : l'inactivité n'est pas surveillée
 * entre `since` et `until` (retour prévu). Après `until`, le temps sans activité se compte à partir de `until`.
 */
export interface Absence {
  since: IsoUtcTimestamp;
  /** Retour prévu, au plus 24 h après `since`. */
  until: IsoUtcTimestamp;
}

/** Type de capteur attendu au domicile (registre des capteurs, ADR 0012). */
export const SensorKind = { PIR: 'PIR', PRESSURE_PLATE: 'PRESSURE_PLATE', WATCH: 'WATCH' } as const;
export type SensorKind = (typeof SensorKind)[keyof typeof SensorKind];

/**
 * Capteur attendu chez le senior : la détection le considère muet s'il ne donne aucun signal pendant
 * `expectedIntervalMinutes` (ADR 0012).
 */
export interface ExpectedSensor {
  sensorId: TopicSafeId;
  kind: SensorKind;
  room: string | null;
  location: string | null;
  /** Délai maximal entre deux signaux de ce capteur (1 à 1440 min). */
  expectedIntervalMinutes: number;
}

export interface ActivityProfile {
  seniorId: TopicSafeId;
  /** Fuseau horaire IANA du logement, pour lire les plages horaires (ex. "Europe/Paris"). */
  timeZone: string;
  thresholds: ToleranceThreshold[];
  /** Absence en cours ou prévue ; null si la personne est chez elle. */
  absence: Absence | null;
  /** Capteurs attendus au domicile, surveillés par la détection (ADR 0012). */
  sensors: ExpectedSensor[];
}

/** Publié par l'API sur profiles/{seniorId} quand l'équipe médicale modifie les seuils. */
export interface ActivityProfileUpdated {
  eventId: Uuid;
  seniorId: TopicSafeId;
  type: 'ActivityProfileUpdated';
  timestamp: IsoUtcTimestamp;
  payload: ActivityProfile;
}

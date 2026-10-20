/** Date ISO 8601 en UTC, ex. "2026-01-15T14:32:08.000Z". */
export type IsoUtcTimestamp = string;

/** UUID, ex. "a1b2c3d4-0001-4000-8000-000000000001". */
export type Uuid = string;

/**
 * Identifiant utilisable dans un topic MQTT (seniorId, sensorId) :
 * lettres, chiffres, "-" et "_" uniquement.
 */
export type TopicSafeId = string;
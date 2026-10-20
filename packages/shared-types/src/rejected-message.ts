// Messages rejetés par l'ingestion (docs/format-evenements.md).

import type { IsoUtcTimestamp, Uuid } from './common.js';

export const RejectionReason = {
  INVALID_JSON: 'INVALID_JSON',
  MISSING_FIELD: 'MISSING_FIELD',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  UNKNOWN_SENSOR: 'UNKNOWN_SENSOR',
} as const;
export type RejectionReason = (typeof RejectionReason)[keyof typeof RejectionReason];

export const IngestionProtocol = { MQTT: 'MQTT', HTTP: 'HTTP' } as const;
export type IngestionProtocol = (typeof IngestionProtocol)[keyof typeof IngestionProtocol];

export interface RejectedMessage {
  eventId: Uuid;
  timestamp: IsoUtcTimestamp;
  source: {
    protocol: IngestionProtocol;
    /** Topic MQTT ou route HTTP d'origine. */
    origin: string;
  };
  reason: RejectionReason;
  details: string;
  /** Message brut tel que reçu ; peut ne pas être du JSON valide. */
  originalMessage: string;
}

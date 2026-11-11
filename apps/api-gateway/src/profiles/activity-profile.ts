// Profil d'activité (docs/format-evenements.md §10, ADR 0010) : conversion depuis la base et validation
// des seuils envoyés par l'application. Fonctions pures, testées sans base.

import { BadRequestException } from '@nestjs/common';
import type { Absence, ActivityProfile, ExpectedSensor, ToleranceThreshold } from '@project/shared-types';
import profileSchema from '@project/shared-types/schemas/activity-profile.schema.json';
import Ajv from 'ajv';

/** Une ligne de la table tolerance_thresholds. */
export interface ThresholdRow {
  condition: string;
  durationInMinutes: number;
  startTime: string | null;
  endTime: string | null;
}

const ajv = new Ajv({ strict: true, allErrors: true }).addSchema(profileSchema);
const validateThresholds = ajv.compile<ToleranceThreshold[]>({
  type: 'array',
  maxItems: 10,
  items: { $ref: `${profileSchema.$id}#/definitions/ToleranceThreshold` },
});

/**
 * Profil du contrat à partir de la base. Ordre stable : plages par heure de début, puis le seuil sans plage.
 * `absence` : absence en cours déclarée par le senior (ADR 0011), null s'il est chez lui.
 * `sensors` : capteurs attendus au domicile, surveillés par la détection (ADR 0012).
 */
export function toActivityProfile(
  senior: { id: string; timeZone: string },
  rows: readonly ThresholdRow[],
  absence: Absence | null = null,
  sensors: readonly ExpectedSensor[] = [],
): ActivityProfile {
  const thresholds = rows
    .filter((r) => r.condition === 'MAX_INACTIVITY_MINUTES')
    .map(
      (r): ToleranceThreshold => ({
        condition: 'MAX_INACTIVITY_MINUTES',
        durationInMinutes: r.durationInMinutes,
        timeRange: r.startTime && r.endTime ? { startTime: r.startTime, endTime: r.endTime } : null,
      }),
    )
    .sort((a, b) => (a.timeRange?.startTime ?? '99:99').localeCompare(b.timeRange?.startTime ?? '99:99'));
  return { seniorId: senior.id, timeZone: senior.timeZone, thresholds, absence, sensors: [...sensors] };
}

/** Vérifie le corps de PUT …/thresholds ; 400 avec un message lisible sinon. */
export function parseThresholds(body: unknown): ToleranceThreshold[] {
  const thresholds = (body as { thresholds?: unknown } | null)?.thresholds;
  if (!validateThresholds(thresholds)) {
    const detail = (validateThresholds.errors ?? []).map((e) => `${e.instancePath || 'thresholds'} ${e.message ?? ''}`.trim()).join(' ; ');
    throw new BadRequestException(`Seuils invalides : ${detail || 'tableau « thresholds » attendu'}`);
  }
  const defaults = thresholds.filter((t) => t.timeRange === null).length;
  if (defaults > 1) throw new BadRequestException('Un seul seuil sans plage horaire est possible (seuil par défaut)');
  return thresholds;
}

/** Ligne à enregistrer pour un seuil. */
export function toRow(seniorId: string, t: ToleranceThreshold): ThresholdRow & { seniorId: string } {
  return {
    seniorId,
    condition: t.condition,
    durationInMinutes: t.durationInMinutes,
    startTime: t.timeRange?.startTime ?? null,
    endTime: t.timeRange?.endTime ?? null,
  };
}

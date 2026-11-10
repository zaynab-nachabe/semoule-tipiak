// Règles de l'absence déclarée (« je m'absente », ADR 0011). Fonctions pures, testées sans base.

import { BadRequestException } from '@nestjs/common';
import type { AbsenceView } from '@project/shared-types';

/** Une absence dure au plus 24 h : au-delà, la surveillance reprend d'elle-même. */
export const MAX_ABSENCE_MS = 24 * 3600_000;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Une ligne de la table absences. */
export interface AbsenceRecord {
  readonly startedAt: Date;
  readonly expectedReturnAt: Date;
  readonly endedAt: Date | null;
}

/** Vérifie le retour prévu envoyé par l'application : ISO 8601 UTC, dans le futur, au plus 24 h ; 400 sinon. */
export function parseReturnTime(body: unknown, now: Date): Date {
  const until = (body as { until?: unknown } | null)?.until;
  if (typeof until !== 'string' || !ISO_UTC.test(until)) {
    throw new BadRequestException('« until » attendu : date ISO 8601 en UTC (ex. 2026-01-15T17:00:00.000Z)');
  }
  const at = new Date(until);
  if (at.getTime() <= now.getTime()) throw new BadRequestException('Le retour prévu doit être dans le futur');
  if (at.getTime() - now.getTime() > MAX_ABSENCE_MS) throw new BadRequestException('Une absence dure au plus 24 h');
  return at;
}

/** L'absence court : ni terminée, ni dépassée. */
export function isOngoing(absence: AbsenceRecord, now: Date): boolean {
  return absence.endedAt === null && absence.expectedReturnAt.getTime() > now.getTime();
}

/**
 * Un mouvement au domicile met fin à l'absence (retour plus tôt que prévu, oubli de « je suis rentré(e) »),
 * sauf pendant le délai de départ qui suit la déclaration (la personne n'est pas encore sortie).
 */
export function endsOnActivity(absence: AbsenceRecord, activityAt: Date, graceMs: number): boolean {
  return isOngoing(absence, activityAt) && activityAt.getTime() - absence.startedAt.getTime() >= graceMs;
}

export function toAbsenceView(absence: AbsenceRecord): AbsenceView {
  return { since: absence.startedAt.toISOString(), until: absence.expectedReturnAt.toISOString() };
}

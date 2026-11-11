// Agrégat ActivityProfile (DDD §4.1) : les seuils d'inactivité d'un senior, configurés par l'équipe
// médicale, et son absence déclarée (docs/format-evenements.md §10, ADR 0010 et 0011). Il répond à deux
// questions : la personne est-elle absente ? sinon, au bout de combien de minutes sans activité lever le doute ?

import type { ActivityProfile as ActivityProfileData, ExpectedSensor, ToleranceThreshold } from '@project/shared-types';

const MINUTES_PER_DAY = 24 * 60;

/** Absence déclarée par le senior (« je m'absente ») : de `since` au retour prévu `until`. */
export interface DeclaredAbsence {
  readonly since: Date;
  readonly until: Date;
}

export class ActivityProfile {
  private constructor(
    readonly seniorId: string,
    readonly timeZone: string,
    readonly thresholds: readonly ToleranceThreshold[],
    readonly absence: DeclaredAbsence | null,
    /** Capteurs attendus au domicile, surveillés par SensorSupervisionService (ADR 0012). */
    readonly sensors: readonly ExpectedSensor[],
  ) {}

  /** Construit le profil à partir du contrat ; refuse un fuseau horaire inconnu. */
  static fromContract(data: ActivityProfileData): ActivityProfile {
    localMinutes(new Date(0), data.timeZone); // lève une RangeError si le fuseau est inconnu
    const absence = data.absence ? Object.freeze({ since: new Date(data.absence.since), until: new Date(data.absence.until) }) : null;
    const thresholds = Object.freeze(data.thresholds.map((t) => Object.freeze({ ...t })));
    const sensors = Object.freeze(data.sensors.map((s) => Object.freeze({ ...s })));
    return new ActivityProfile(data.seniorId, data.timeZone, thresholds, absence, sensors);
  }

  /** La personne est sortie : pas de surveillance de l'inactivité jusqu'au retour prévu (ADR 0011). */
  isAbsentAt(at: Date): boolean {
    return this.absence !== null && at.getTime() < this.absence.until.getTime();
  }

  /**
   * Point de départ du temps sans activité : la dernière activité, ou le retour prévu s'il est plus récent
   * (une personne qui ne rentre pas est signalée après le seuil habituel, compté depuis son retour prévu).
   */
  inactiveSince(lastActivityAt: Date): Date {
    const returnAt = this.absence?.until;
    return returnAt && returnAt.getTime() > lastActivityAt.getTime() ? returnAt : lastActivityAt;
  }

  /**
   * Seuil applicable (en minutes) à l'instant `at` ; null si aucun seuil ne couvre cette heure.
   *  1. au lit (repos normal) : le seuil le plus long du profil ;
   *  2. sinon, parmi les seuils dont la plage contient l'heure locale, le plus court ;
   *  3. sinon, le seuil sans plage, s'il existe.
   */
  applicableThresholdMinutes(at: Date, resting: boolean): number | null {
    if (this.thresholds.length === 0) return null;
    if (resting) return Math.max(...this.thresholds.map((t) => t.durationInMinutes));
    const now = localMinutes(at, this.timeZone);
    const inRange = this.thresholds.filter((t) => t.timeRange !== null && contains(t.timeRange, now));
    if (inRange.length > 0) return Math.min(...inRange.map((t) => t.durationInMinutes));
    const fallback = this.thresholds.filter((t) => t.timeRange === null);
    return fallback.length > 0 ? Math.min(...fallback.map((t) => t.durationInMinutes)) : null;
  }

  /** DDD : evaluateInactivity(lastMovementTimestamp). Vrai si le temps sans activité atteint le seuil applicable. */
  evaluateInactivity(lastActivityAt: Date, now: Date, resting: boolean): boolean {
    const minutes = this.applicableThresholdMinutes(now, resting);
    return minutes !== null && now.getTime() - lastActivityAt.getTime() >= minutes * 60_000;
  }
}

/** Minutes écoulées depuis minuit, en heure locale du fuseau. */
export function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return (hour * 60 + minute) % MINUTES_PER_DAY;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Plage [début, fin[ ; elle peut passer minuit (22:00 → 07:00). Début = fin : toute la journée. */
function contains(range: { startTime: string; endTime: string }, minutes: number): boolean {
  const start = toMinutes(range.startTime);
  const end = toMinutes(range.endTime);
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

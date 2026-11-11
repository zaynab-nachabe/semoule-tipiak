// « Je m'absente » (ADR 0011) : calcul de l'heure de retour choisie par le senior. Testé dans test/absence.test.ts.

/** Une absence dure au plus 24 h (règle de l'API). */
export const MAX_ABSENCE_MS = 24 * 3600_000;

/**
 * Heure de retour « HH:MM » (heure du navigateur) → instant : aujourd'hui, ou demain si l'heure est déjà passée.
 * null si le format est invalide.
 */
export function returnTimeFor(hhmm: string, now: Date): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const at = new Date(now);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime() - now.getTime() <= MAX_ABSENCE_MS ? at : null;
}

/** Heure proposée par défaut : dans 2 h, arrondie au quart d'heure suivant. */
export function defaultReturnTime(now: Date): string {
  const at = new Date(now.getTime() + 2 * 3600_000);
  const quarter = Math.ceil(at.getMinutes() / 15) * 15;
  at.setMinutes(quarter, 0, 0);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

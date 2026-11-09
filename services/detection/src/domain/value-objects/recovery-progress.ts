// Value object RecoveryProgress : où en est la séquence de relèvement après un impact
// (docs/format-evenements.md §6, ADR-0004).
//
//   FALLEN ──(PIR_MOTION ou PRESSURE_PLATE après l'impact)──► ACTIVE
//   ACTIVE ──(PRESSURE_PLATE PRESSED, ou PIR_MOTION dans une autre pièce, dans le délai)──► RECOVERED
//
// Un seul signal ne suffit jamais : une personne au sol peut bouger et déclencher un détecteur.

import type { RawSignal } from '@project/shared-types';

export type ActivitySignal = Extract<RawSignal, { type: 'PIR_MOTION' | 'PRESSURE_PLATE' }>;

export type RecoveryProgress =
  | { readonly stage: 'FALLEN' }
  | { readonly stage: 'ACTIVE'; readonly activityAt: Date; readonly room: string }
  | { readonly stage: 'RECOVERED'; readonly confirmedAt: Date; readonly confirmingEventId: string };

export const FALLEN: RecoveryProgress = Object.freeze({ stage: 'FALLEN' });

export function isActivitySignal(signal: RawSignal): signal is ActivitySignal {
  return signal.type === 'PIR_MOTION' || signal.type === 'PRESSURE_PLATE';
}

/**
 * Fait avancer la séquence avec un signal d'activité. Renvoie un nouvel objet (immuable).
 * @param impactAt horodatage de l'impact : les signaux antérieurs (reçus en retard) sont ignorés
 * @param windowMs délai maximal entre l'activité et la stabilité
 */
export function advanceRecovery(progress: RecoveryProgress, signal: ActivitySignal, impactAt: Date, windowMs: number): RecoveryProgress {
  const at = new Date(signal.timestamp);
  if (at.getTime() <= impactAt.getTime() || progress.stage === 'RECOVERED') {
    return progress;
  }
  if (progress.stage === 'FALLEN') {
    return activity(at, signal);
  }

  const elapsed = at.getTime() - progress.activityAt.getTime();
  if (elapsed <= 0) {
    return progress;
  }
  if (elapsed > windowMs) {
    // Trop tard pour confirmer cette activité : ce signal devient la nouvelle activité de référence.
    return activity(at, signal);
  }
  const onFurniture = signal.type === 'PRESSURE_PLATE' && signal.payload.state === 'PRESSED';
  const movedAway = signal.type === 'PIR_MOTION' && signal.payload.room !== progress.room;
  if (onFurniture || movedAway) {
    return Object.freeze({ stage: 'RECOVERED', confirmedAt: at, confirmingEventId: signal.eventId });
  }
  return progress;
}

function activity(at: Date, signal: ActivitySignal): RecoveryProgress {
  return Object.freeze({ stage: 'ACTIVE', activityAt: at, room: signal.payload.room });
}

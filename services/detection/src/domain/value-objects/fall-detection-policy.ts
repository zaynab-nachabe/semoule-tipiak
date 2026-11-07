// Paramètres de la détection de chute.
// Seul le délai de pré-confirmation est documenté (DDD, scénario A : 60 s).
// Les autres valeurs n'ont PAS été décidées par l'équipe : elles sont obligatoires
// et n'ont volontairement pas de valeur par défaut (voir services/detection/README.md).

import type { Severity, SignalType } from '@project/shared-types';

/** DDD, scénario A : « Un minuteur de 60 secondes démarre. » */
export const DDD_PRE_CONFIRMATION_DELAY_MS = 60_000;

export interface FallDetectionPolicy {
  /** Durée de la levée de doute avant escalade. Documenté : DDD_PRE_CONFIRMATION_DELAY_MS. */
  readonly preConfirmationDelayMs: number;
  /** Impact minimal (en g) pour suspecter une chute. NON DOCUMENTÉ. */
  readonly minFallImpact: number;
  /** Gravité d'une alerte critique de chute. NON DOCUMENTÉ. */
  readonly fallAlertSeverity: Severity;
  /** Gravité d'une demande d'aide spontanée. NON DOCUMENTÉ. */
  readonly helpRequestSeverity: Severity;
  /**
   * Signaux qui prouvent une reprise d'activité après l'impact et annulent la pré-confirmation
   * (DDD §4.2 : « fausse alerte confirmée par un mouvement »). Lesquels : NON DOCUMENTÉ.
   */
  readonly activityResumedSignalTypes: readonly SignalType[];
}

export function assertValidPolicy(policy: FallDetectionPolicy): void {
  if (!Number.isFinite(policy.preConfirmationDelayMs) || policy.preConfirmationDelayMs <= 0) {
    throw new Error('preConfirmationDelayMs doit être un nombre strictement positif');
  }
  if (!Number.isFinite(policy.minFallImpact) || policy.minFallImpact < 0) {
    throw new Error('minFallImpact doit être un nombre positif ou nul');
  }
  const forbidden: readonly SignalType[] = ['FALL_IMPACT', 'HELP_BUTTON', 'CANCEL_ALERT'];
  for (const type of policy.activityResumedSignalTypes) {
    if (forbidden.includes(type)) {
      throw new Error(`${type} ne peut pas servir de preuve de reprise d'activité`);
    }
  }
}

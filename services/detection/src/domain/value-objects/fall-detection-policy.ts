// Paramètres de la détection de chute. Chaque valeur est justifiée dans un ADR (docs/adr/).

export interface FallDetectionPolicy {
  /** Durée de la levée de doute (niveau 1). DDD, scénario A : 60 s. */
  readonly preConfirmationDelayMs: number;
  /** Pic d'impact minimal (SVtot, en g) pour suspecter une chute. ADR-0003 : 3,0 g (montre au poignet). */
  readonly minFallImpact: number;
  /** Délai maximal entre l'activité et la stabilité dans la séquence de relèvement. ADR-0004 : 90 s. */
  readonly recoveryConfirmationWindowMs: number;
  /** Délai après une alerte de niveau 2 sans relèvement avant le passage au niveau 3. ADR-0005 : 5 min. */
  readonly criticalEscalationDelayMs: number;
}

export const DEFAULT_FALL_DETECTION_POLICY: FallDetectionPolicy = Object.freeze({
  preConfirmationDelayMs: 60_000,
  minFallImpact: 3.0,
  recoveryConfirmationWindowMs: 90_000,
  criticalEscalationDelayMs: 5 * 60_000,
});

export function assertValidPolicy(policy: FallDetectionPolicy): void {
  const positive: (keyof FallDetectionPolicy)[] = ['preConfirmationDelayMs', 'recoveryConfirmationWindowMs', 'criticalEscalationDelayMs'];
  for (const key of positive) {
    const value = policy[key];
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${key} doit être un nombre strictement positif (reçu : ${value})`);
    }
  }
  if (!Number.isFinite(policy.minFallImpact) || policy.minFallImpact < 0) {
    throw new Error(`minFallImpact doit être un nombre positif ou nul (reçu : ${policy.minFallImpact})`);
  }
}

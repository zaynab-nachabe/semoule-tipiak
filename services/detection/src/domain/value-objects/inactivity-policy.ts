// Paramètres de la détection d'inactivité (ADR 0010). Les seuils eux-mêmes viennent du profil de chaque
// senior ; ces valeurs-ci règlent la vérification et le croisement avec la fréquence cardiaque.

export interface InactivityPolicy {
  /** Fréquence de la vérification des seuils. 60 s : un seuil se compte en minutes. */
  readonly checkIntervalMs: number;
  /** Une fréquence cardiaque plus ancienne ne prouve plus rien : la montre est considérée muette. 10 min. */
  readonly heartRateFreshnessMs: number;
  /** Plage de fréquence cardiaque considérée normale au repos chez une personne âgée (bpm). */
  readonly normalHeartRate: { readonly min: number; readonly max: number };
}

export const DEFAULT_INACTIVITY_POLICY: InactivityPolicy = Object.freeze({
  checkIntervalMs: 60_000,
  heartRateFreshnessMs: 10 * 60_000,
  normalHeartRate: Object.freeze({ min: 40, max: 150 }),
});

export function assertValidInactivityPolicy(policy: InactivityPolicy): void {
  for (const key of ['checkIntervalMs', 'heartRateFreshnessMs'] as const) {
    if (!Number.isFinite(policy[key]) || policy[key] <= 0) {
      throw new Error(`${key} doit être un nombre strictement positif (reçu : ${policy[key]})`);
    }
  }
  const { min, max } = policy.normalHeartRate;
  if (!(Number.isFinite(min) && Number.isFinite(max) && min > 0 && min < max)) {
    throw new Error(`normalHeartRate invalide : ${min} à ${max}`);
  }
}

/** Fréquence cardiaque récente et dans la plage normale : la personne est en vie, peut-être endormie. */
export function hasReassuringHeartRate(
  last: { readonly value: number; readonly at: Date } | null,
  now: Date,
  policy: InactivityPolicy,
): boolean {
  if (!last) return false;
  const fresh = now.getTime() - last.at.getTime() <= policy.heartRateFreshnessMs;
  return fresh && last.value >= policy.normalHeartRate.min && last.value <= policy.normalHeartRate.max;
}

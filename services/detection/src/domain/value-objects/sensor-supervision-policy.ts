// Paramètres de la surveillance des capteurs (ADR 0012). L'intervalle attendu de chaque capteur vient du
// registre (profil d'activité) ; ces valeurs-ci règlent la vérification et le seuil de batterie.

export interface SensorSupervisionPolicy {
  /** Fréquence de la vérification des capteurs muets. 60 s : les intervalles attendus se comptent en minutes. */
  readonly checkIntervalMs: number;
  /** Batterie faible en dessous de ce pourcentage : il reste quelques jours à quelques semaines. */
  readonly lowBatteryPercent: number;
}

export const DEFAULT_SENSOR_SUPERVISION_POLICY: SensorSupervisionPolicy = Object.freeze({
  checkIntervalMs: 60_000,
  lowBatteryPercent: 20,
});

export function assertValidSupervisionPolicy(policy: SensorSupervisionPolicy): void {
  if (!Number.isFinite(policy.checkIntervalMs) || policy.checkIntervalMs <= 0) {
    throw new Error(`checkIntervalMs doit être un nombre strictement positif (reçu : ${policy.checkIntervalMs})`);
  }
  if (!Number.isFinite(policy.lowBatteryPercent) || policy.lowBatteryPercent < 0 || policy.lowBatteryPercent > 100) {
    throw new Error(`lowBatteryPercent doit être entre 0 et 100 (reçu : ${policy.lowBatteryPercent})`);
  }
}

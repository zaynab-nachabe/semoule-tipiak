// Configuration du service, lue dans les variables d'environnement (docker-compose.yml).
// Les valeurs de détection ont des valeurs par défaut justifiées dans les ADR ; les variables
// permettent de les raccourcir pour une démonstration.

import {
  DEFAULT_FALL_DETECTION_POLICY,
  assertValidPolicy,
  type FallDetectionPolicy,
} from '../domain/value-objects/fall-detection-policy.js';

export interface DetectionConfig {
  readonly mqttUrl: string;
  /** Identifiant fixe : avec une session persistante, le broker garde les messages reçus pendant un redémarrage. */
  readonly mqttClientId: string;
  readonly policy: FallDetectionPolicy;
}

type Env = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Env = process.env): DetectionConfig {
  const d = DEFAULT_FALL_DETECTION_POLICY;
  const policy: FallDetectionPolicy = {
    preConfirmationDelayMs: seconds(env, 'PRE_CONFIRMATION_DELAY_S', d.preConfirmationDelayMs),
    minFallImpact: number(env, 'FALL_MIN_IMPACT_G', d.minFallImpact),
    recoveryConfirmationWindowMs: seconds(env, 'RECOVERY_WINDOW_S', d.recoveryConfirmationWindowMs),
    criticalEscalationDelayMs: seconds(env, 'CRITICAL_ESCALATION_DELAY_S', d.criticalEscalationDelayMs),
  };
  assertValidPolicy(policy);
  return {
    mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
    mqttClientId: env.MQTT_CLIENT_ID || 'detection',
    policy,
  };
}

function number(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} doit être un nombre (reçu : "${raw}")`);
  }
  return value;
}

function seconds(env: Env, name: string, fallbackMs: number): number {
  return Math.round(number(env, name, fallbackMs / 1000) * 1000);
}

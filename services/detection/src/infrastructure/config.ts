// Configuration du service, lue dans les variables d'environnement (docker-compose.yml).
// Les valeurs de détection ont des valeurs par défaut justifiées dans les ADR ; les variables
// permettent de les raccourcir pour une démonstration.

import {
  DEFAULT_FALL_DETECTION_POLICY,
  assertValidPolicy,
  type FallDetectionPolicy,
} from '../domain/value-objects/fall-detection-policy.js';
import {
  DEFAULT_SENSOR_SUPERVISION_POLICY,
  assertValidSupervisionPolicy,
  type SensorSupervisionPolicy,
} from '../domain/value-objects/sensor-supervision-policy.js';
import {
  DEFAULT_INACTIVITY_POLICY,
  assertValidInactivityPolicy,
  type InactivityPolicy,
} from '../domain/value-objects/inactivity-policy.js';

/** Où lire les profils d'activité au démarrage (ADR 0010). */
export interface ProfileSource {
  readonly apiUrl: string;
  readonly serviceToken: string;
  /** Attente entre deux essais tant que l'API ne répond pas. */
  readonly retryDelayMs: number;
}

export interface DetectionConfig {
  readonly mqttUrl: string;
  /** Identifiant fixe : avec une session persistante, le broker garde les messages reçus pendant un redémarrage. */
  readonly mqttClientId: string;
  readonly policy: FallDetectionPolicy;
  /** Absent : valeurs par défaut (ADR 0010). */
  readonly inactivityPolicy?: InactivityPolicy;
  /** Absent : valeurs par défaut (ADR 0012). */
  readonly supervisionPolicy?: SensorSupervisionPolicy;
  /** Absent : pas de chargement initial (tests) ; les profils arrivent alors seulement par message. */
  readonly profileSource?: ProfileSource;
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
  const i = DEFAULT_INACTIVITY_POLICY;
  const inactivityPolicy: InactivityPolicy = {
    checkIntervalMs: seconds(env, 'INACTIVITY_CHECK_INTERVAL_S', i.checkIntervalMs),
    heartRateFreshnessMs: seconds(env, 'HEART_RATE_FRESHNESS_S', i.heartRateFreshnessMs),
    normalHeartRate: i.normalHeartRate,
  };
  assertValidInactivityPolicy(inactivityPolicy);
  const sp = DEFAULT_SENSOR_SUPERVISION_POLICY;
  const supervisionPolicy: SensorSupervisionPolicy = {
    checkIntervalMs: seconds(env, 'SENSOR_CHECK_INTERVAL_S', sp.checkIntervalMs),
    lowBatteryPercent: number(env, 'LOW_BATTERY_PERCENT', sp.lowBatteryPercent),
  };
  assertValidSupervisionPolicy(supervisionPolicy);
  return {
    mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
    mqttClientId: env.MQTT_CLIENT_ID || 'detection',
    policy,
    inactivityPolicy,
    supervisionPolicy,
    profileSource: {
      apiUrl: (env.API_URL || 'http://localhost:3000').replace(/\/$/, ''),
      serviceToken: env.SERVICE_TOKEN || 'dev-service-token-change-me',
      retryDelayMs: 5_000,
    },
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

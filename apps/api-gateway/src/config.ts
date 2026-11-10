// Configuration lue dans les variables d'environnement (docker-compose.yml).

export interface ApiConfig {
  readonly port: number;
  readonly mqttUrl: string;
  readonly mqttClientId: string;
  readonly jwtSecret: string;
  readonly jwtExpiresIn: string;
  /** Node-RED, qui reçoit les actions de l'application (ADR 0007). Réseau interne uniquement. */
  readonly nodeRedUrl: string;
  /** Clé partagée avec la détection pour GET /internal/activity-profiles (ADR 0010). */
  readonly serviceToken: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`PORT invalide : ${env.PORT}`);
  return {
    port,
    mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
    mqttClientId: env.MQTT_CLIENT_ID || 'api-gateway',
    jwtSecret: env.JWT_SECRET || 'dev-secret-change-me',
    jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
    serviceToken: env.SERVICE_TOKEN || 'dev-service-token-change-me',
    nodeRedUrl: (env.NODE_RED_URL || 'http://localhost:1880').replace(/\/$/, ''),
  };
}

export const API_CONFIG = Symbol('API_CONFIG');

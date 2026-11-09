// Configuration du service, lue dans les variables d'environnement (docker-compose.yml).

export interface NotificationConfig {
  readonly mqttUrl: string;
  /** Identifiant fixe : avec une session persistante, le broker garde les alertes reçues pendant un redémarrage. */
  readonly mqttClientId: string;
}

export function loadConfig(env: Readonly<Record<string, string | undefined>> = process.env): NotificationConfig {
  return {
    mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
    mqttClientId: env.MQTT_CLIENT_ID || 'notification',
  };
}

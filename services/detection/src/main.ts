// Point d'entrée exécutable (conteneur « detection »).

import { startDetection } from './app.js';
import { loadConfig } from './infrastructure/config.js';
import { jsonLogger } from './infrastructure/logger.js';

const config = loadConfig();
jsonLogger.info('démarrage', { mqttUrl: config.mqttUrl, clientId: config.mqttClientId, policy: config.policy });

startDetection(config, jsonLogger)
  .then((running) => {
    const shutdown = (signal: string) => {
      jsonLogger.info('arrêt demandé', { signal });
      void running.stop().then(() => process.exit(0));
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((error: unknown) => {
    jsonLogger.error('démarrage impossible', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });

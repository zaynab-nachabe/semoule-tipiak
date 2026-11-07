// Dépôt AlertRepository (DDD §4.6).
// Synchrone : l'état des alertes en cours vit en mémoire (pas de requête BDD dans le chemin temps réel).
// L'historique durable des alertes est tenu ailleurs, à partir des événements publiés.

import type { Alert } from '../entities/alert.js';

export interface AlertRepository {
  findActiveAlertsBySeniorId(seniorId: string): Alert[];
  save(alert: Alert): void;
}
